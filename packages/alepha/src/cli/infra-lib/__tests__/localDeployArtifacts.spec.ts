import { Alepha } from "alepha";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

import { BayAdapter } from "../adapters/BayAdapter.ts";
import { CloudflareAdapter } from "../adapters/CloudflareAdapter.ts";
import type { InfraContext } from "../adapters/InfraAdapter.ts";

class CloudflareProbe extends CloudflareAdapter {
  readonly validate = this.validateDeployArtifact.bind(this);
}
class BayProbe extends BayAdapter {
  readonly validate = this.validateDeployArtifact.bind(this);
}

const manifest = (runtime = "workerd") => ({
  project: "demo",
  runtimes: [
    {
      runtime,
      ...(runtime === "static" ? {} : { entry: `index.${runtime}.js` }),
    },
  ],
  resources: {
    hasDatabase: false,
    hasBucket: false,
    hasAnalytics: false,
    hasKV: false,
    hasQueue: false,
    hasCron: false,
    hasWebSocket: false,
  },
  crons: [],
  secrets: [],
  variables: [],
});
const setup = () => {
  const alepha = Alepha.create()
    .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
    .with({ provide: ShellProvider, use: MemoryShellProvider });
  return {
    alepha,
    fs: alepha.inject(MemoryFileSystemProvider),
    shell: alepha.inject(MemoryShellProvider),
    ctx: { root: "/project" } as InfraContext,
  };
};

describe("local deployment artifact checks", () => {
  it("refuses absent/malformed manifests with full-build guidance before transport", async ({
    expect,
  }) => {
    for (const contents of [
      undefined,
      "{",
      "{}",
      JSON.stringify(manifest("bun")),
    ]) {
      const { alepha, fs, shell, ctx } = setup();
      if (contents !== undefined)
        await fs.writeFile("/project/dist/manifest.json", contents);
      for (const adapter of [
        alepha.inject(CloudflareProbe),
        alepha.inject(BayProbe),
      ]) {
        await expect(adapter.validate(ctx)).rejects.toThrow(/alepha deploy/);
      }
      expect(shell.calls).toEqual([]);
    }
  });

  it("requires both the workerd slice and generated Wrangler worker entry", async ({
    expect,
  }) => {
    const { alepha, fs, ctx } = setup();
    const adapter = alepha.inject(CloudflareProbe);
    await fs.writeFile(
      "/project/dist/manifest.json",
      JSON.stringify(manifest()),
    );
    await expect(adapter.validate(ctx)).rejects.toThrow(
      /alepha build --runtime workerd/,
    );
    await fs.writeFile(
      "/project/dist/wrangler.jsonc",
      JSON.stringify({ main: "./main.cloudflare.js" }),
    );
    await fs.writeFile("/project/dist/index.workerd.js", "");
    await expect(adapter.validate(ctx)).rejects.toThrow(
      /generated worker entry/,
    );
    await fs.writeFile("/project/dist/main.cloudflare.js", "");
    await expect(adapter.validate(ctx)).resolves.toBeUndefined();
  });

  it("requires a supported Bay node entry or static public output", async ({
    expect,
  }) => {
    for (const runtime of ["node", "static"]) {
      const { alepha, fs, ctx } = setup();
      const adapter = alepha.inject(BayProbe);
      await fs.writeFile(
        "/project/dist/manifest.json",
        JSON.stringify(manifest(runtime)),
      );
      await expect(adapter.validate(ctx)).rejects.toThrow(
        /supported node\/static/,
      );
      await fs.writeFile(
        runtime === "node"
          ? "/project/dist/index.node.js"
          : "/project/dist/public/index.html",
        "",
      );
      await expect(adapter.validate(ctx)).resolves.toBeUndefined();
    }
  });
});
