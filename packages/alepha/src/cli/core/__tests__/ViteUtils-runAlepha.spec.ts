import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import type { AppEntry } from "../providers/AppEntryProvider.ts";
import { ViteUtils } from "../services/ViteUtils.ts";

/**
 * Stands in for Vite: records the config `runAlepha` creates its server
 * from, and answers `ssrLoadModule` the way a real server entry does, by
 * leaving the app on `globalThis.__alepha`.
 */
class FakeViteUtils extends ViteUtils {
  public serverConfigs: any[] = [];

  public async importVite(): Promise<any> {
    return {
      createServer: async (config: any) => {
        this.serverConfigs.push(config);
        return {
          ssrLoadModule: async () => {
            (globalThis as any).__alepha = Alepha.create();
            return {};
          },
          close: async () => {},
        };
      },
    };
  }
}

const entry: AppEntry = { root: "/app", server: "src/main.server.ts" };

describe("ViteUtils — the server behind runAlepha", () => {
  it("should keep the client dependency optimizer off", async () => {
    /*
      The regression this exists for.

      `runAlepha` only ever calls `ssrLoadModule`, but the server it creates
      also ran Vite's CLIENT dependency optimizer: no entries, nothing to
      scan, and on crawl end it committed an EMPTY pre-bundle into the app's
      `node_modules/.vite/deps`, the directory a running `alepha dev` on the
      same app serves its pre-bundled dependencies from. That commit renames
      the live directory away and deletes it, so from then on every
      dependency the browser had not loaded yet came back
      `504 Outdated Optimize Dep`, and only a restart of the dev server
      recovered. Every `alepha build`, `gen env` or `db …` in the same
      checkout did it, which is how `yarn v` in one terminal broke `yarn dev`
      in another, most of the time.

      `noDiscovery` with an empty `include` is Vite's own switch for "no
      optimizer at all" (`isDepOptimizationDisabled`): the environment is
      created without one and never touches the cache directory.
    */
    const nodeEnv = process.env.NODE_ENV;
    const alepha = Alepha.create().with({
      provide: ViteUtils,
      use: FakeViteUtils,
    });
    const vite = alepha.inject(FakeViteUtils);

    try {
      await vite.runAlepha({ entry, mode: "development" });
    } finally {
      process.env.NODE_ENV = nodeEnv;
      delete (globalThis as any).__alepha;
    }

    expect(vite.serverConfigs).toHaveLength(1);
    const { optimizeDeps } = vite.serverConfigs[0];
    expect(optimizeDeps?.noDiscovery).toBe(true);
    expect(optimizeDeps?.include ?? []).toHaveLength(0);
  });
});
