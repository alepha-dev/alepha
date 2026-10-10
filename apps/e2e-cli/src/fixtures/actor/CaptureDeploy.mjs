import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { $inject, Alepha } from "alepha";
import {
  CloudflareAdapter,
  CloudflareDeployClient,
  NamingService,
  WorkerCloudflareAdapter,
  WranglerApi,
} from "alepha/cli/infra-lib";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";

class CapturedWrangler extends WranglerApi {
  fs = $inject(FileSystemProvider);
  configs = [];
  async deploy(_name, path) {
    this.configs.push(await this.fs.readJsonFile(path));
    return "https://fixture.workers.dev";
  }
}

const app = Alepha.create({ env: { LOG_LEVEL: "error" } })
  .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
  .with({ provide: ShellProvider, use: MemoryShellProvider })
  .with({ provide: WranglerApi, use: CapturedWrangler });
const fs = app.inject(MemoryFileSystemProvider);
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
const worker = app
  .inject(WorkerCloudflareAdapter)
  .use({ apiToken: "fixture", accountId: "fixture" });
worker.deployer = () => client;
const local = app.inject(CloudflareAdapter);
const run = Object.assign(
  async (task) => {
    for (const item of Array.isArray(task) ? task : [task])
      await item.handler();
  },
  { end: () => {} },
);
const naming = app.inject(NamingService);

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
  await local.deploy(context("/local"), run);
  const metadata = captures.at(-1);
  const config = app.inject(CapturedWrangler).configs.at(-1);
  assert.deepEqual(metadata.exports, config.exports);
  assert.deepEqual(
    metadata.bindings.filter(
      (binding) => binding.type === "durable_object_namespace",
    ),
    config.durable_objects.bindings.map((binding) => ({
      type: "durable_object_namespace",
      ...binding,
    })),
  );
  assert.equal(metadata.migrations, undefined);
  assert.equal(worker.provisionedResources.durableObjects, true);
}
console.log(
  JSON.stringify({
    uploads: captures.length,
    classes: captures.map((metadata) => Object.keys(metadata.exports)),
    transports: ["Wrangler configuration", "multipart metadata"],
  }),
);
