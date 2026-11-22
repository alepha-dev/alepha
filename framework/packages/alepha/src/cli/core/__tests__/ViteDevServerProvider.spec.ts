import { EventEmitter } from "node:events";

import { $hook, Alepha, AlephaError, type AlephaMeta } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { afterEach, describe, it } from "vitest";

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
      throw new AlephaError("still broken");
    }
    return {} as Alepha;
  }

  protected override sendBrowserReload(): void {}
  protected override sendErrorOverlay(): void {}
  protected override logError(): void {}
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("ViteDevServerProvider: retry loop", () => {
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
    await expect(provider.start()).rejects.toThrow(
      "Port 4321 is already in use",
    );
  });
});

/**
 * A watcher on which a file is saved as soon as something listens for one:
 * the edit a developer makes after reading the error.
 */
class SavingWatcher extends EventEmitter {
  public override on(event: string, listener: (...args: any[]) => void): this {
    super.on(event, listener);
    if (event === "change") {
      queueMicrotask(() => this.emit("change", "/app/src/main.server.ts"));
    }
    return this;
  }
}

/**
 * Stands in for Vite's `loadEnv`: the `.env` of the app, as the test last
 * wrote it.
 */
class EnvFileViteUtils extends ViteUtils {
  public envFile: Record<string, string> = {};

  public override async importVite(): Promise<any> {
    return { loadEnv: () => ({ ...this.envFile }) };
  }
}

/**
 * The real loader and the real start, over a Vite server reduced to an entry
 * module the test writes: `entryModule` is what evaluating it does.
 */
class EntryViteDevServerProvider extends ViteDevServerProvider {
  public loads = 0;
  public entryModule: () => void = () => {};

  public testLoadAlepha = () => this.loadAlepha(true);

  public useFakeServer(): void {
    this.options = {
      root: "/app",
      entry: { root: "/app", server: "src/main.server.ts" },
    } as DevServerOptions;
    this.server = {
      watcher: new SavingWatcher(),
      config: { server: { port: 4321 } },
      moduleGraph: {
        invalidateAll: () => {},
        getModulesByFile: () => undefined,
      },
      ssrLoadModule: async () => {
        this.loads += 1;
        this.entryModule();
        return {};
      },
      listen: async () => {},
    } as any;
  }

  protected override sendBrowserReload(): void {}
  protected override sendErrorOverlay(): void {}
  protected override logError(): void {}
}

describe("ViteDevServerProvider: an app that fails to load or start", () => {
  const ENV_KEY = "ALEPHA_DEV_SPEC_VALUE";
  const realEnv = process.env;

  afterEach(() => {
    process.env = realEnv;
    delete process.env[ENV_KEY];
    (globalThis as any).__alepha = undefined;
  });

  const setup = () => {
    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ViteUtils, use: EnvFileViteUtils });
    const provider = alepha.inject(EntryViteDevServerProvider);
    provider.useFakeServer();
    return { provider, vite: alepha.inject(EnvFileViteUtils) };
  };

  it("drops the .env values of a load that failed after the entry was evaluated", async ({
    expect,
  }) => {
    const { provider, vite } = setup();
    const seen: Array<string | undefined> = [];

    // An entry saved half-edited: it evaluates, and never reaches `run()`.
    vite.envFile = { [ENV_KEY]: "one" };
    provider.entryModule = () => {
      seen.push(process.env[ENV_KEY]);
    };
    await expect(provider.testLoadAlepha()).rejects.toThrow(
      /Alepha instance not found/,
    );

    expect(process.env[ENV_KEY]).toBeUndefined();

    // The entry is fixed and the `.env` edited: the next load reads the file
    // as it is now.
    vite.envFile = { [ENV_KEY]: "two" };
    provider.entryModule = () => {
      seen.push(process.env[ENV_KEY]);
      (globalThis as any).__alepha = Alepha.create();
    };
    await provider.testLoadAlepha();

    expect(seen).toEqual(["one", "two"]);
  });

  it("keeps waiting for an edit while the app still fails to start", async ({
    expect,
  }) => {
    const { provider } = setup();
    let failures = 2;
    let stopped = 0;

    class Database {
      protected readonly onStop = $hook({
        on: "stop",
        handler: () => {
          stopped += 1;
        },
      });

      protected readonly onStart = $hook({
        on: "start",
        handler: () => {
          if (failures > 0) {
            failures -= 1;
            throw new AlephaError("db down");
          }
        },
      });
    }

    provider.entryModule = () => {
      (globalThis as any).__alepha = Alepha.create().with(Database);
    };
    await provider.testLoadAlepha();

    // Every save reloads an app whose start hook still fails: the second
    // failure used to end `alepha dev`.
    await provider.start();

    expect(failures).toBe(0);
    // A failed `start()` unwinds itself: each instance whose start failed
    // ran its stop hooks, so the retry loop leaves none half-started.
    expect(stopped).toBe(2);
    expect(provider.loads).toBe(3);
    expect(provider.alepha?.isStarted()).toBe(true);
    await provider.alepha?.stop();
  });
});

/**
 * A loader whose partial reload fails the way a module graph that went stale
 * mid-load does, and whose full reload succeeds.
 */
class StaleGraphViteDevServerProvider extends ViteDevServerProvider {
  public readonly loads: Array<"partial" | "full"> = [];
  public overlays = 0;
  public brokenOnFullReload = false;

  public async testReload(files: string[]): Promise<void> {
    for (const file of files) this.changedFiles.add(file);
    await this.performReload();
  }

  public get loaded(): boolean {
    return this.alepha !== null && this.alepha !== undefined;
  }

  protected override async loadAlepha(
    _isInitialLoad = false,
    _filesToInvalidate?: Set<string>,
  ): Promise<Alepha> {
    const kind = this.hasError ? "full" : "partial";
    this.loads.push(kind);
    if (kind === "partial" || this.brokenOnFullReload) {
      this.hasError = true;
      throw new AlephaError("TOO_LATE_SUBSTITUTION");
    }
    this.hasError = false;
    this.alepha = { start: async () => {} } as unknown as Alepha;
    return this.alepha;
  }

  protected override sendBrowserReload(): void {}
  protected override sendErrorOverlay(): void {
    this.overlays += 1;
  }
  protected override logError(): void {}
}

describe("ViteDevServerProvider: a partial reload that fails", () => {
  it("retries once with the whole graph before reporting anything", async ({
    expect,
  }) => {
    // A save landing while a reload is loading lets Vite evaluate a module
    // file twice, so one `$module` exists as two classes and is registered
    // twice. Only a partial reload can see that; a full one never does.
    const provider = Alepha.create().inject(StaleGraphViteDevServerProvider);

    await provider.testReload(["/src/Home.tsx"]);

    expect(provider.loads).toEqual(["partial", "full"]);
    expect(provider.overlays).toBe(0);
    expect(provider.loaded).toBe(true);
  });

  it("still reports an error the full reload repeats", async ({ expect }) => {
    const provider = Alepha.create().inject(StaleGraphViteDevServerProvider);
    provider.brokenOnFullReload = true;

    await provider.testReload(["/src/Home.tsx"]);

    expect(provider.loads).toEqual(["partial", "full"]);
    expect(provider.overlays).toBe(1);
    expect(provider.loaded).toBe(false);
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
      createLogger: () => ({ error: () => {} }),
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
  public installed: AlephaMeta[] = [];

  public async resolve(): Promise<AlephaMeta> {
    return { name: "shop" } as AlephaMeta;
  }

  public install(meta: AlephaMeta): void {
    this.installed.push(meta);
  }
}

/**
 * A provider whose dev head can be read without a Vite server.
 */
class HeadViteDevServerProvider extends ViteDevServerProvider {
  public async head(options: Partial<DevServerOptions>): Promise<string> {
    this.options = options as DevServerOptions;
    this.server = {
      transformIndexHtml: async (_url: string, html: string) => html,
    } as any;
    return this.generateDevHead();
  }
}

describe("ViteDevServerProvider: host, constants and CORS", () => {
  const configFor = async (options: Partial<DevServerOptions>) => {
    const alepha = Alepha.create()
      .with({ provide: ViteUtils, use: RecordingViteUtils })
      .with({ provide: MetaResolver, use: FixedMetaResolver });
    await alepha
      .inject(ViteDevServerProvider)
      .init({
        root: "/app",
        entry: { root: "/app", server: "src/main.server.ts" },
        port: 4321,
        ...options,
      } as DevServerOptions)
      .catch(() => undefined);
    return alepha.inject(RecordingViteUtils).configs[0] as any;
  };

  it("binds the host it is given, and only then", async ({ expect }) => {
    expect((await configFor({ host: "0.0.0.0" })).server.host).toBe("0.0.0.0");
    expect((await configFor({})).server.host).toBeUndefined();
  });

  it("leaves CORS to the app", async ({ expect }) => {
    // Vite's middleware answered preflights before the app's own policy.
    expect((await configFor({})).server.cors).toBe(false);
  });

  it("adds the caller's constants to the server's define", async ({
    expect,
  }) => {
    const config = await configFor({
      define: { __APP_CONFIG__: '{"mode":"dev"}' },
    });

    expect(config.define.__APP_CONFIG__).toBe('{"mode":"dev"}');
  });

  it("installs the build record in this process, for an alepha Vite SSR externalizes", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with({ provide: ViteUtils, use: RecordingViteUtils })
      .with({ provide: MetaResolver, use: FixedMetaResolver });
    await alepha
      .inject(ViteDevServerProvider)
      .init({
        root: "/app",
        entry: { root: "/app", server: "src/main.server.ts" },
        port: 4321,
      } as DevServerOptions)
      .catch(() => undefined);

    // `define` never reaches `alepha` loaded from node_modules downstream.
    expect(alepha.inject(FixedMetaResolver).installed).toEqual([
      { name: "shop" },
    ]);
  });

  it("hands the caller's constants to the browser as globals, and nothing without them", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const provider = alepha.inject(HeadViteDevServerProvider);
    const entry = { root: "/app", server: "src/main.server.ts" };

    const withConstants = await provider.head({
      entry,
      define: { __APP_CONFIG__: '{"apiUrl":"https://api.test"}' },
    });
    const plain = await provider.head({ entry });

    expect(withConstants).toContain(
      'globalThis["__APP_CONFIG__"]={"apiUrl":"https://api.test"};',
    );
    expect(plain).not.toContain("__APP_CONFIG__");
  });
});

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
