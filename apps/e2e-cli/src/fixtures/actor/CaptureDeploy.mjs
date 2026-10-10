import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { Alepha } from "alepha";
import {
  CloudflareAdapter,
  CloudflareCredentialSource,
  CloudflareDeployClient,
  NamingService,
  WorkerCloudflareAdapter,
} from "alepha/cli/infra-lib";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";

// One transport since #Q2612: `alepha deploy` hands its `dist/` to the upload
// Lore runs. This captures the multipart metadata of both callers for the same
// artifact and asserts they agree.

const captures = [];
const noOp = async () => ({});
const api = {
  put: async (_path, options) => {
    captures.push(JSON.parse(await options.body.get("metadata").text()));
    return { result: {} };
  },
  workers: {
    scripts: {
      schedules: { update: noOp },
      subdomain: { create: noOp },
      versions: { list: async () => ({ result: { items: [] } }) },
    },
    subdomains: { get: async () => ({ subdomain: "fixture" }) },
  },
};
const client = new CloudflareDeployClient({
  apiToken: "fixture",
  accountId: "fixture",
  client: api,
});
const provisioner = {
  getWorkerMigrationTag: async () => undefined,
  listQueues: async () => [],
  listSecrets: async () => [],
};

class CapturedWorker extends WorkerCloudflareAdapter {
  deployer() {
    return client;
  }
  provisioner() {
    return provisioner;
  }
}
class CapturedLocal extends CloudflareAdapter {
  provisioner() {
    return provisioner;
  }
}
class FixtureCredential extends CloudflareCredentialSource {
  async resolve() {
    return {
      credential: { apiToken: "fixture", accountId: "fixture" },
      origin: "env",
    };
  }
}

const app = Alepha.create({ env: { LOG_LEVEL: "error" } })
  .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
  .with({ provide: ShellProvider, use: MemoryShellProvider })
  .with({ provide: CloudflareCredentialSource, use: FixtureCredential })
  .with({ provide: WorkerCloudflareAdapter, use: CapturedWorker })
  .with({ provide: CloudflareAdapter, use: CapturedLocal });
const fs = app.inject(MemoryFileSystemProvider);
const worker = app
  .inject(WorkerCloudflareAdapter)
  .use({ apiToken: "fixture", accountId: "fixture" });
const local = app.inject(CloudflareAdapter);
const run = Object.assign(
  async (task) => {
    for (const item of Array.isArray(task) ? task : [task])
      await item.handler();
  },
  { end: () => {} },
);
const naming = app.inject(NamingService);
const classes = [];

for (const variant of ["actor", "combined"]) {
  const dist = join(process.cwd(), variant, "dist");
  const manifest = JSON.parse(
    await readFile(join(dist, "manifest.json"), "utf8"),
  );
  const copy = async (directory, relative = "") => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const name = relative + entry.name;
      if (entry.isDirectory()) await copy(path, name + "/");
      else {
        const bytes = await readFile(path);
        await fs.writeFile(`/worker/${name}`, bytes);
        await fs.writeFile(`/local/dist/${name}`, bytes);
      }
    }
  };
  await copy(dist);
  await fs.writeFile("/local/dist/manifest.json", JSON.stringify(manifest));
  const context = (root) => ({
    project: manifest.project,
    env: "test",
    root,
    prebuilt: true,
    options: {},
    entry: { root, server: "" },
    resources: manifest.resources,
    naming: naming.forContext(manifest.project, "test"),
  });
  await worker.build(context("/worker"), run);
  await local.build(context("/local"), run);
  await worker.deploy(context("/worker"), run);
  const lore = captures.at(-1);
  await local.deploy(context("/local"), run);
  const cli = captures.at(-1);
  assert.notEqual(cli, lore);
  assert.deepEqual(cli, lore);
  const config = JSON.parse(
    await fs.readTextFile("/local/dist/wrangler.jsonc"),
  );
  assert.deepEqual(lore.exports, config.exports);
  assert.deepEqual(
    lore.bindings.filter(
      (binding) => binding.type === "durable_object_namespace",
    ),
    config.durable_objects.bindings.map((binding) => ({
      type: "durable_object_namespace",
      ...binding,
    })),
  );
  assert.equal(lore.migrations, undefined);
  assert.equal(worker.provisionedResources.durableObjects, true);
  classes.push(Object.keys(lore.exports));
}
console.log(
  JSON.stringify({
    uploads: captures.length,
    classes,
    transports: ["multipart metadata"],
  }),
);
