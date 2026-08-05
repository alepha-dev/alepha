import { Alepha } from "alepha";
import { type BuildTarget, buildOptions } from "alepha/cli";
import { DateTimeProvider } from "alepha/datetime";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";
import { LoreAdapter } from "../adapters/LoreAdapter.ts";
import type { PlatformContext } from "../adapters/PlatformAdapter.ts";

/**
 * Exposes what the adapter keeps protected.
 *
 * The three things under test here all run before a single byte moves — the
 * credential check, the project check and the release name — which is exactly
 * why they are worth pinning cheaply. Everything past them needs a live sink
 * and belongs in the e2e.
 */
class TestLoreAdapter extends LoreAdapter {
  public testProjectId = this.projectId.bind(this);
  public testApiKey = this.apiKey.bind(this);
  public testEndpoint = this.endpoint.bind(this);
  public testVersion = this.version.bind(this);
}

const contextFor = (envConfig: Record<string, unknown>): PlatformContext =>
  ({
    project: "lindocara-main",
    env: "production",
    envConfig,
    root: "/tmp/project",
  }) as unknown as PlatformContext;

describe("LoreAdapter", () => {
  const setup = async () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    const adapter = alepha.inject(TestLoreAdapter);
    await alepha.start();
    return { adapter };
  };

  it("refuses to deploy without a credential, and names where to get one", async ({
    expect,
  }) => {
    const { adapter } = await setup();
    const previous = process.env.LORE_API_KEY;
    process.env.LORE_API_KEY = undefined as unknown as string;
    delete process.env.LORE_API_KEY;

    try {
      expect(() => adapter.testApiKey()).toThrow(/LORE_API_KEY/);
    } finally {
      if (previous !== undefined) {
        process.env.LORE_API_KEY = previous;
      }
    }
  });

  it("refuses a config with no project rather than guessing one", async ({
    expect,
  }) => {
    const { adapter } = await setup();

    // Guessing from this app's project name would silently deploy into
    // whichever Lore project happened to match — two namespaces that have no
    // relationship.
    expect(() =>
      adapter.testProjectId(contextFor({ adapter: "lore" })),
    ).toThrow(/projectId/);
  });

  it("falls back to the public instance and trims a trailing slash", async ({
    expect,
  }) => {
    const { adapter } = await setup();

    expect(adapter.testEndpoint(contextFor({ adapter: "lore" }))).toBe(
      "https://lore.alepha.dev",
    );
    expect(
      adapter.testEndpoint(
        contextFor({ adapter: "lore", endpoint: "https://lore.test/" }),
      ),
    ).toBe("https://lore.test");
  });

  it("names a release the way Bay names a release directory", async ({
    expect,
  }) => {
    // The format is a contract with the supervisor: a release in Lore and a
    // release on disk have to be the same string, or every comparison between
    // them becomes a correlation problem.
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } }).with({
      provide: DateTimeProvider,
      use: FixedClock,
    });
    const adapter = alepha.inject(TestLoreAdapter);
    await alepha.start();

    expect(adapter.testVersion()).toBe("2026-08-03-140506");
  });

  describe("the build target", () => {
    /*
      `build` hardcoded `--target=bare`.

      The hardcode is load-bearing: a workerd bundle is resolved against
      Cloudflare's export conditions and leaves no entry point node can run, so
      one reaching a machine produces an app that deploys, never boots, and
      reports only "never became ready". But an explicit flag also OVERRIDES
      the workspace's own `alepha.config.ts`, so a site declaring
      `target: "static"` was built as a server and shipped a bundle the
      supervisor would try to spawn.

      `BayAdapter` was taught the exception and this was not, which left it
      unreachable in practice: Lore is the adapter for a machine whose control
      API is a unix socket, so it is the only one CI can deploy through.
    */
    const buildWith = async (target?: BuildTarget) => {
      const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
        .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
        .with({ provide: ShellProvider, use: MemoryShellProvider });
      const fs = alepha.inject(MemoryFileSystemProvider);
      await fs.writeFile("/project/yarn.lock", "");
      if (target) {
        alepha.store.mut(buildOptions, (current) => ({ ...current, target }));
      }
      const adapter = alepha.inject(TestLoreAdapter);
      // The runner is a pass-through here: what these tests are about is the
      // command the adapter composes, not how the step is reported.
      const run = ((task: { handler: () => Promise<void> }) =>
        task.handler()) as any;
      await adapter.build(
        {
          ...contextFor({ adapter: "lore" }),
          root: "/project",
        } as PlatformContext,
        run,
      );
      return alepha.inject(MemoryShellProvider);
    };

    it("builds a declared static site as static", async ({ expect }) => {
      const shell = await buildWith("static");

      expect(shell.wasCalled("yarn alepha build --target=static")).toBe(true);
    });

    it("still forces bare when nothing is declared", async ({ expect }) => {
      const shell = await buildWith();

      expect(shell.wasCalled("yarn alepha build --target=bare")).toBe(true);
    });

    it("refuses to inherit a cloudflare target", async ({ expect }) => {
      // The reason the hardcode exists. A workerd bundle has no entry point
      // node can run, so inheriting this would deploy an app that never boots.
      const shell = await buildWith("cloudflare");

      expect(shell.wasCalled("yarn alepha build --target=bare")).toBe(true);
    });
  });
});

/**
 * A clock stopped at a known instant.
 *
 * Substituted rather than mocked — the container is what makes this
 * unnecessary to fake, and a stopped clock is the only way to assert the exact
 * string instead of the shape of it.
 */
class FixedClock extends DateTimeProvider {
  public override nowMillis(): number {
    return Date.parse("2026-08-03T14:05:06.789Z");
  }
}
