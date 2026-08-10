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

  it("adds the Analytics Engine read credential to the secret allowlist", async ({
    expect,
  }) => {
    /*
      ⚠️ Regression guard for a production outage (2026-08-11). `manifest.env`
      is the allowlist `alepha platform up` pushes worker secrets from, and it
      comes from `alepha.dump().env` — the env keys of the graph as
      instantiated HERE, under node. `CLOUDFLARE_ANALYTICS_TOKEN` is declared
      by `WaeAnalyticsProvider`, which only ever exists under workerd, so it
      was never in the list and `platform up` silently filtered it out of
      every push. The operator sets it in `.env.production`, the deploy
      reports success, and the worker boots without it — then throws
      "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_ANALYTICS_TOKEN must both be set"
      on every analytics read.

      Exactly the hazard this file already documents for R2 bindings, one
      layer over: not a missing binding, a missing SECRET. Detection is the
      fix, because detection is the one thing that does work from node.
    */
    const manifest = (await detect({ analyticsPrimitives: 1 })) as unknown as {
      env: string[];
    };

    expect(manifest.env).toContain("CLOUDFLARE_ANALYTICS_TOKEN");
    // The read is account-scoped, so the id is as load-bearing as the token.
    expect(manifest.env).toContain("CLOUDFLARE_ACCOUNT_ID");
  });

  it("does not add the credential when the app has no analytics", async ({
    expect,
  }) => {
    const manifest = (await detect({ analyticsPrimitives: 0 })) as unknown as {
      env: string[];
    };

    expect(manifest.env ?? []).not.toContain("CLOUDFLARE_ANALYTICS_TOKEN");
  });
});
