import { EventEmitter } from "node:events";

import { Alepha, AlephaError } from "alepha";
import { CommandError } from "alepha/command";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import {
  type DevServerOptions,
  ViteDevServerProvider,
} from "../providers/ViteDevServerProvider.ts";

class TestViteDevServerProvider extends ViteDevServerProvider {
  public closed = false;
  public waited = false;
  public logged: Array<{ title: string; hint?: string; retrying?: boolean }> =
    [];

  public testOnStartupError = this.onStartupError.bind(this);
  public testHint = this.missingWorkspaceHint.bind(this);
  public testViteLogger = this.createViteLogger.bind(this);

  public setup(options: Partial<DevServerOptions>): void {
    this.options = { root: "/repo/apps/web", entry: {}, ...options } as any;
    this.server = {
      watcher: new EventEmitter(),
      close: async () => {
        this.closed = true;
      },
    } as any;
  }

  protected override logError(
    title: string,
    _err: unknown,
    options: { hint?: string; retrying?: boolean } = {},
  ): void {
    this.logged.push({ title, ...options });
  }
}

const create = () => {
  const alepha = Alepha.create().with({
    provide: FileSystemProvider,
    use: MemoryFileSystemProvider,
  });
  return {
    provider: alepha.inject(TestViteDevServerProvider),
    fs: alepha.inject(MemoryFileSystemProvider),
  };
};

const notFound = () =>
  new AlephaError(
    "Cannot find module '@acme/core/api' imported from '/repo/apps/web/src/main.server.ts'",
  );

describe("ViteDevServerProvider: a failed first boot", () => {
  it("exits with a one-line reason when nobody can fix it", async ({
    expect,
  }) => {
    const { provider } = create();
    provider.setup({ exitOnStartupError: true });

    await expect(
      provider.testOnStartupError(new AlephaError("boom")),
    ).rejects.toThrow(CommandError);
    await expect(
      provider.testOnStartupError(new AlephaError("boom")),
    ).rejects.toThrow('alepha dev: failed reason="boom"');
    expect(provider.closed).toBe(true);
    expect(provider.logged[0]).toMatchObject({
      title: "Startup failed",
      retrying: false,
    });
  });

  it("keeps waiting for a fix in a terminal", async ({ expect }) => {
    const { provider } = create();
    provider.setup({ exitOnStartupError: false });

    await provider.testOnStartupError(new AlephaError("boom"));

    expect(provider.closed).toBe(false);
    expect(provider.logged[0].retrying).toBe(true);
  });
});

describe("ViteDevServerProvider: missing workspace link hint", () => {
  it("names the install when a workspace dependency is not linked", async ({
    expect,
  }) => {
    const { provider, fs } = create();
    provider.setup({});
    await fs.writeFile(
      "/repo/apps/web/package.json",
      JSON.stringify({ dependencies: { "@acme/core": "workspace:*" } }),
    );

    const hint = await provider.testHint(notFound());

    expect(hint).toContain("@acme/core is a workspace dependency");
    expect(hint).toContain("install");
  });

  it("says nothing once the package is linked higher up", async ({
    expect,
  }) => {
    const { provider, fs } = create();
    provider.setup({});
    await fs.writeFile(
      "/repo/apps/web/package.json",
      JSON.stringify({ dependencies: { "@acme/core": "workspace:*" } }),
    );
    await fs.writeFile(
      "/repo/node_modules/@acme/core/package.json",
      JSON.stringify({ name: "@acme/core" }),
    );

    expect(await provider.testHint(notFound())).toBeUndefined();
  });

  it("says nothing for a registry dependency or a relative import", async ({
    expect,
  }) => {
    const { provider, fs } = create();
    provider.setup({});
    await fs.writeFile(
      "/repo/apps/web/package.json",
      JSON.stringify({ dependencies: { "@acme/core": "^1.0.0" } }),
    );

    expect(await provider.testHint(notFound())).toBeUndefined();
    expect(
      await provider.testHint(new AlephaError("Cannot find module './x.ts'")),
    ).toBeUndefined();
  });
});

describe("ViteDevServerProvider: Vite's logger", () => {
  it("drops Vite's copy of an SSR evaluation error and keeps the rest", ({
    expect,
  }) => {
    const { provider } = create();
    const seen: string[] = [];
    const base = {
      error: (msg: string) => seen.push(msg),
    };

    const logger = provider.testViteLogger(() => base as any);
    logger.error("Error when evaluating SSR module src/main.server.ts: boom");
    logger.error("Pre-transform error: something else");

    expect(seen).toEqual(["Pre-transform error: something else"]);
  });
});
