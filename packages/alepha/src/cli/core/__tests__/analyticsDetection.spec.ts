import { Alepha } from "alepha";
import { afterEach, describe, it } from "vitest";
import { BuildManifestTask } from "../tasks/BuildManifestTask.ts";

/**
 * Mirrors `r2Detection.spec.ts` for the Analytics Engine resource.
 *
 * `$analytics` (alepha/analytics) is a primitive, so the build can see it —
 * that is the common case and needs no escape hatch. But a workspace can
 * also already have `CLOUDFLARE_ANALYTICS_DATASET` set by hand in
 * `.env.production`, from before this mechanism existed (that hand-edit is
 * exactly what this feature exists to make unnecessary going forward), so an
 * explicit value must keep working as a first-class way to declare the need,
 * the same way `R2_BUCKET_NAME` does for `hasBucket`.
 */
describe("analytics resource detection", () => {
  const original = process.env.CLOUDFLARE_ANALYTICS_DATASET;

  afterEach(() => {
    if (original === undefined) delete process.env.CLOUDFLARE_ANALYTICS_DATASET;
    else process.env.CLOUDFLARE_ANALYTICS_DATASET = original;
  });

  /** Drives the private detection through a minimal fake context. */
  const detect = async (opts: {
    analyticsPrimitives: number;
    envDataset?: string;
  }) => {
    if (opts.envDataset === undefined) {
      delete process.env.CLOUDFLARE_ANALYTICS_DATASET;
    } else {
      process.env.CLOUDFLARE_ANALYTICS_DATASET = opts.envDataset;
    }

    const captured: Record<string, unknown>[] = [];
    // The task uses $inject, so it must come from a container.
    const task = Alepha.create().inject(BuildManifestTask);

    const ctx = {
      root: "/tmp/app",
      alepha: {
        primitives: (name: string) =>
          name === "$analytics"
            ? new Array(opts.analyticsPrimitives).fill({})
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
    return captured[0] as { resources: { hasAnalytics: boolean } };
  };

  it("detects analytics from a $analytics primitive", async ({ expect }) => {
    const manifest = await detect({ analyticsPrimitives: 1 });
    expect(manifest.resources.hasAnalytics).toBe(true);
  });

  it("detects analytics from an explicit CLOUDFLARE_ANALYTICS_DATASET", async ({
    expect,
  }) => {
    const manifest = await detect({
      analyticsPrimitives: 0,
      envDataset: "my_dataset",
    });
    expect(manifest.resources.hasAnalytics).toBe(true);
  });

  it("reports no analytics when neither signal is present", async ({
    expect,
  }) => {
    const manifest = await detect({ analyticsPrimitives: 0 });
    expect(manifest.resources.hasAnalytics).toBe(false);
  });
});
