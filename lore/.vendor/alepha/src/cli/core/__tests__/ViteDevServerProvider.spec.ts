import { EventEmitter } from "node:events";

import { Alepha, AlephaError, type AlephaMeta } from "alepha";
import { describe, it } from "vitest";

import {
  type DevServerOptions,
  ViteDevServerProvider,
} from "../providers/ViteDevServerProvider.ts";
import { MetaResolver } from "../services/MetaResolver.ts";
import { ViteUtils } from "../services/ViteUtils.ts";

/**
 * Replaces the two things the retry loop touches - the file watcher and the
 * loader - with something a test can drive, and holds the first load open so
 * the "a change arrived mid-restart" window can be inspected while it is open.
 */
class TestViteDevServerProvider extends ViteDevServerProvider {
  public readonly loadCalls: Array<Set<string>> = [];
  public readonly watcher = new EventEmitter();
  public readonly firstAttempt = Promise.withResolvers<void>();

  public testWaitForSuccessfulLoad = this.waitForSuccessfulLoad.bind(this);
  public testStart = this.start.bind(this);

  public useFakeServer(listen: () => Promise<void>): void {
    this.server = {
      watcher: this.watcher,
      config: { server: { port: 4321 } },
      listen,
    } as any;
  }

  protected override async loadAlepha(
    _isInitialLoad = false,
    filesToInvalidate?: Set<string>,
  ): Promise<Alepha> {
    const attempt = this.loadCalls.push(new Set(filesToInvalidate ?? []));
    if (attempt === 1) {
      // Hold the first attempt open for as long as the test wants.
      await this.firstAttempt.promise;
      throw new Error("still broken");
    }
    return {} as Alepha;
  }

  protected override sendBrowserReload(): void {}
  protected override sendErrorOverlay(): void {}
  protected override logError(): void {}
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("ViteDevServerProvider — retry loop", () => {
  it("coalesces changes that arrive while a retry is in flight", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const provider = alepha.inject(TestViteDevServerProvider);
    provider.useFakeServer(async () => {});

    const loaded = provider.testWaitForSuccessfulLoad();

    provider.watcher.emit("change", "/src/a.ts");
    await tick();

    // Two more files land while the first attempt is still running - a "save
    // all", a git checkout, a formatter sweep. Each used to start its own
    // concurrent load against the same module graph.
    provider.watcher.emit("change", "/src/b.ts");
    provider.watcher.emit("change", "/src/c.ts");
    await tick();

    expect(provider.loadCalls.length).toBe(1);

    provider.firstAttempt.resolve();
    await loaded;

    // One follow-up, carrying BOTH files saved while the first ran.
    expect(provider.loadCalls.length).toBe(2);
    expect([...provider.loadCalls[1]].sort()).toEqual([
      "/src/b.ts",
      "/src/c.ts",
    ]);
  });

  it("a port already in use ends the dev server instead of waiting for an edit", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const provider = alepha.inject(TestViteDevServerProvider);
    provider.useFakeServer(async () => {
      const error: NodeJS.ErrnoException = new Error(
        "listen EADDRINUSE: address already in use :::4321",
      );
      error.code = "EADDRINUSE";
      throw error;
    });

    // No edit can free a socket, so falling into the retry loop here left the
    // command sitting there looking alive while serving nothing.
    await expect(provider.testStart()).rejects.toThrow(
      "Port 4321 is already in use",
    );
  });
});

/**
 * Stands in for Vite: records the config the dev server is created from and
 * stops there, since the config is all this spec reads.
 */
class RecordingViteUtils extends ViteUtils {
  public configs: Array<{ plugins?: Array<{ name?: string }> }> = [];

  public async importVite(): Promise<any> {
    return {
      createServer: async (config: any) => {
        this.configs.push(config);
        throw new AlephaError("stop: the config is all this spec reads");
      },
      resolveConfig: async () => ({ server: {} }),
    };
  }

  public async importViteReact(): Promise<any> {
    return undefined;
  }
}

/**
 * A build record without the git calls behind the real one.
 */
class FixedMetaResolver extends MetaResolver {
  public async resolve(): Promise<AlephaMeta> {
    return {} as AlephaMeta;
  }
}

describe("ViteDevServerProvider: the Vite server it creates", () => {
  it("renders the app's .client modules on the server as the build does: not at all", async ({
    expect,
  }) => {
    // Without this, a server render of a `.client` module would show its
    // real content under `alepha dev` and nothing in production.
    const alepha = Alepha.create()
      .with({ provide: ViteUtils, use: RecordingViteUtils })
      .with({ provide: MetaResolver, use: FixedMetaResolver });
    const provider = alepha.inject(ViteDevServerProvider);
    const vite = alepha.inject(RecordingViteUtils);

    await expect(
      provider.init({
        root: "/app",
        entry: { root: "/app", server: "src/main.server.ts" },
        port: 4321,
      } as DevServerOptions),
    ).rejects.toThrow(/stop/);

    const names = (vite.configs[0]?.plugins ?? []).map(
      (plugin) => plugin?.name,
    );
    expect(names).toContain("alepha-client-modules");
  });
});
