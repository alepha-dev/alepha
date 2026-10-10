import { Alepha } from "alepha";
import { EnvUtils } from "alepha/command";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import { resolveSecretKeySet } from "../secretKeys.ts";

describe("resolveSecretKeySet", () => {
  const setup = async (files: Record<string, string>) => {
    const alepha = Alepha.create().with({
      provide: FileSystemProvider,
      use: MemoryFileSystemProvider,
    });
    const fs = alepha.inject(MemoryFileSystemProvider);
    for (const [path, content] of Object.entries(files)) {
      await fs.writeFile(`/project/${path}`, content);
    }
    const resolve = (keys?: string[]) =>
      resolveSecretKeySet({
        fs,
        envUtils: alepha.inject(EnvUtils),
        root: "/project",
        env: "production",
        keys,
      });
    return { resolve };
  };

  const manifest = JSON.stringify({
    secrets: [{ name: "APP_SECRET" }, { name: "STRIPE_KEY" }],
    variables: [{ name: "PUBLIC_FLAG" }],
  });

  it("uses the explicit override alone, ignoring the manifest and the files", async ({
    expect,
  }) => {
    const { resolve } = await setup({
      "dist/manifest.json": manifest,
      ".env.production": "FROM_FILE=1",
      ".env.production.local": "FROM_LOCAL=1",
    });

    const result = await resolve(["ONLY_THIS"]);

    expect(result.keys).toEqual(["ONLY_THIS"]);
    // The values are still the file's, for `selectSecrets` to read from.
    expect(result.envVars).toMatchObject({ FROM_FILE: "1" });
  });

  it("takes the manifest's declared keys, not the base file's", async ({
    expect,
  }) => {
    const { resolve } = await setup({
      "dist/manifest.json": manifest,
      ".env.production": "APP_SECRET=s3cret\nCLOUDFLARE_API_TOKEN=local-only",
    });

    const result = await resolve();

    // A local infra credential in the base file never joins the key set.
    expect(result.keys.sort()).toEqual([
      "APP_SECRET",
      "PUBLIC_FLAG",
      "STRIPE_KEY",
    ]);
    expect(result.envVars.APP_SECRET).toBe("s3cret");
  });

  it("falls back to the .env.<env> file's own keys when there is no manifest", async ({
    expect,
  }) => {
    const { resolve } = await setup({
      ".env.production": "APP_SECRET=s3cret\nOTHER=1",
    });

    const result = await resolve();

    expect(result.keys.sort()).toEqual(["APP_SECRET", "OTHER"]);
  });

  it("unions the .env.<env>.local keys with the manifest's", async ({
    expect,
  }) => {
    const { resolve } = await setup({
      "dist/manifest.json": manifest,
      ".env.production.local": "INJECTED_CONFIG=x",
    });

    const result = await resolve();

    expect(result.keys.sort()).toEqual([
      "APP_SECRET",
      "INJECTED_CONFIG",
      "PUBLIC_FLAG",
      "STRIPE_KEY",
    ]);
  });
});
