import { Alepha } from "alepha";
import { afterEach, describe, it } from "vitest";

import { BuildManifestTask } from "../tasks/BuildManifestTask.ts";

/**
 * Object storage can be declared two ways, and only one of them is
 * detectable by introspection.
 *
 * `$storage` (alepha/api/files) is a primitive, so the build can see it.
 * But `alepha/bucket` also documents injecting `FileStorageProvider`
 * directly — "blobs without a database" — and that declares no
 * primitive. Worse, it cannot be inferred: the build introspects the app
 * under **node**, where `alepha/bucket` binds Local/Memory/S3, while the
 * hard `R2_BUCKET_NAME` requirement only exists in the **workerd**
 * variant.
 *
 * The result was a worker that built and uploaded but could not boot,
 * rejected with a bare `SchemaValidationError: 'R2_BUCKET_NAME' is
 * required` — after the migrate step had already run against production.
 *
 * So setting `R2_BUCKET_NAME` is a first-class way to declare the need.
 */
describe("R2 resource detection", () => {
  const original = process.env.R2_BUCKET_NAME;

  afterEach(() => {
    if (original === undefined) delete process.env.R2_BUCKET_NAME;
    else process.env.R2_BUCKET_NAME = original;
  });

  /** Drives the private detection through a minimal fake context. */
  const detect = async (opts: {
    storagePrimitives: number;
    envBucket?: string;
  }) => {
    if (opts.envBucket === undefined) delete process.env.R2_BUCKET_NAME;
    else process.env.R2_BUCKET_NAME = opts.envBucket;

    const captured: Record<string, unknown>[] = [];
    // The task uses $inject, so it must come from a container.
    const task = Alepha.create().inject(BuildManifestTask);

    const ctx = {
      root: "/tmp/app",
      alepha: {
        primitives: (name: string) =>
          name === "$storage"
            ? Array.from({ length: opts.storagePrimitives }, () => ({}))
            : [],
        inject: () => {
          throw new Error("not available");
        },
      },
      options: {},
    };

    // `writeManifest` is protected; reach it the same way the build does.
    const self = task as unknown as {
      fs: unknown;
      writeManifest: (ctx: unknown, distDir: string) => Promise<void>;
    };
    self.fs = {
      join: (...p: string[]) => p.join("/"),
      async writeFile(_path: string, body: string) {
        captured.push(JSON.parse(body));
      },
      async exists() {
        return false;
      },
      async mkdir() {},
      async readJsonFile() {
        throw new Error("no package.json in this fake");
      },
    };

    await self.writeManifest(ctx, "dist");
    return captured[0] as { resources: { hasBucket: boolean } };
  };

  it("detects storage from a $storage primitive", async ({ expect }) => {
    const manifest = await detect({ storagePrimitives: 1 });
    expect(manifest.resources.hasBucket).toBe(true);
  });

  it("detects storage from an explicit R2_BUCKET_NAME", async ({ expect }) => {
    // The FileStorageProvider route: no primitive, but the app says it
    // needs a bucket. Before this, the deploy produced an unbootable
    // worker.
    const manifest = await detect({
      storagePrimitives: 0,
      envBucket: "my-bucket",
    });
    expect(manifest.resources.hasBucket).toBe(true);
  });

  it("reports no storage when neither signal is present", async ({
    expect,
  }) => {
    const manifest = await detect({ storagePrimitives: 0 });
    expect(manifest.resources.hasBucket).toBe(false);
  });
});
