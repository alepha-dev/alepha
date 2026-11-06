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

  it("should load the app with its .client modules stubbed, as the server bundle has them", async () => {
    // `build`, `gen env`, `db …` and the build's own analysis all read the app
    // through this server. Were a `.client` module real here and a stub in the
    // bundle, the two would be describing different apps.
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

    const names = (vite.serverConfigs[0].plugins ?? []).map(
      (plugin: { name?: string }) => plugin?.name,
    );
    expect(names).toContain("alepha-client-modules");
  });
});

describe("ViteUtils: the APP_SECRET placeholder", () => {
  it("should give the loaded app a placeholder and leave none in process.env", async () => {
    // #Q3148: the placeholder used to stay in `process.env` for the rest of
    // the process, and `alepha deploy` runs the build and the secrets step in
    // one process: `selectSecrets` read it back and pushed it as the app's
    // production APP_SECRET.
    const nodeEnv = process.env.NODE_ENV;
    const before = process.env.APP_SECRET;
    delete process.env.APP_SECRET;
    const alepha = Alepha.create().with({
      provide: ViteUtils,
      use: FakeViteUtils,
    });
    const vite = alepha.inject(FakeViteUtils);

    try {
      const app = await vite.runAlepha({ entry, mode: "production" });

      expect(app.env.APP_SECRET).toBe(ViteUtils.PLACEHOLDER_APP_SECRET);
      expect(process.env.APP_SECRET).toBeUndefined();
    } finally {
      process.env.NODE_ENV = nodeEnv;
      if (before === undefined) delete process.env.APP_SECRET;
      else process.env.APP_SECRET = before;
      delete (globalThis as any).__alepha;
    }
  });

  it("should leave an APP_SECRET that was already set untouched", async () => {
    const nodeEnv = process.env.NODE_ENV;
    const before = process.env.APP_SECRET;
    process.env.APP_SECRET = "set-by-the-deployer";
    const alepha = Alepha.create().with({
      provide: ViteUtils,
      use: FakeViteUtils,
    });
    const vite = alepha.inject(FakeViteUtils);

    try {
      const app = await vite.runAlepha({ entry, mode: "production" });

      expect(app.env.APP_SECRET).toBe("set-by-the-deployer");
      expect(process.env.APP_SECRET).toBe("set-by-the-deployer");
    } finally {
      process.env.NODE_ENV = nodeEnv;
      if (before === undefined) delete process.env.APP_SECRET;
      else process.env.APP_SECRET = before;
      delete (globalThis as any).__alepha;
    }
  });
});
