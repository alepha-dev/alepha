import { Alepha } from "alepha";
import { PlatformOrchestrator, platformOptions } from "alepha/cli/platform-lib";
import { HttpError } from "alepha/server";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, expect, it } from "vitest";

import { LoreAdapter } from "../adapters/LoreAdapter.ts";
import { lore } from "../index.ts";
import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreDeployer } from "../services/LoreDeployer.ts";
import { LoreSecretsService } from "../services/LoreSecretsService.ts";

/**
 * `alepha platform up` against a `lore()` environment, driven through the real
 * orchestrator with Lore faked at the `$client` seams.
 *
 * ⚠️ The two load-bearing cases: the secrets land BEFORE the run starts (a
 * build booting without a secret it needs fails at boot, where the reason is
 * hard to read), and the build asks for the runtime the copy's estate accepts
 * (a Cloudflare estate runs `workerd`, whatever the workspace defaults to).
 */
describe("LoreAdapter", () => {
  const create = async (
    options: {
      env?: Record<string, string>;
      instance?: { id: string; estateId?: string } | null;
      descriptor?: ReturnType<typeof lore>;
    } = {},
  ) => {
    const alepha = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        LORE_API_KEY: "k",
        LORE_URL: "",
        LORE_PROJECT: "",
        HOME: "/nonexistent",
        ...options.env,
      },
    })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      // What `platform()` does for every environment, at configure time.
      .with(LoreAdapter);

    alepha.set(platformOptions, {
      name: "docs",
      environments: {
        production: options.descriptor ?? lore({ project: "alepha" }),
      },
    });

    const fs = alepha.inject(MemoryFileSystemProvider);
    const shell = alepha.inject(MemoryShellProvider);
    await fs.writeFile(
      "/project/package.json",
      JSON.stringify({ name: "docs" }),
    );
    await fs.writeFile(
      "/project/.env.production",
      "APP_SECRET=s3cret\nSIGIL_KEY=sg_old\nDATABASE_URL=sqlite://local",
    );
    await fs.writeFile(
      "/project/dist/manifest.json",
      JSON.stringify({
        secrets: [
          { name: "APP_SECRET" },
          { name: "SIGIL_KEY" },
          { name: "DATABASE_URL" },
          { name: "LOG_LEVEL" },
        ],
        variables: [],
      }),
    );

    /**
     * Everything Lore was asked, in order.
     */
    const events: string[] = [];
    const instance =
      options.instance === undefined
        ? { id: "inst-1", estateId: "cf-1" }
        : options.instance;

    Object.assign(alepha.inject(LoreDeployer) as unknown as object, {
      apps: {
        getApp: async () => {
          if (!instance) {
            throw new HttpError({ status: 404, message: "App not found" });
          }
          return instance;
        },
      },
      estates: {
        listProjectEstates: async () => ({
          items: [{ id: "cf-1", acceptedRuntimes: ["workerd"] }],
        }),
      },
      deploys: {
        startDeploy: async ({ body }: { body: { tag: string } }) => {
          events.push(`start ${body.tag}`);
          return { id: "dep-1", status: "queued" };
        },
        getDeployment: async () => ({
          status: "succeeded",
          url: "https://docs.alepha.dev",
          log: [],
        }),
      },
      artifacts: {
        push: async (input: { app: string; tag: string }) => {
          events.push(`push ${input.app}@${input.tag}`);
        },
      },
    });
    Object.assign(alepha.inject(LoreSecretsService) as unknown as object, {
      secrets: {
        setAppSecret: async ({
          params,
          body,
        }: {
          params: { instanceId: string };
          body: { key: string };
        }) => {
          events.push(`secret ${body.key} on ${params.instanceId}`);
          return { id: "s", key: body.key };
        },
      },
    });
    Object.assign(alepha.inject(LoreAdapter) as unknown as object, {
      projects: { resolve: async () => 1 },
    });

    const up = () =>
      alepha.inject(PlatformOrchestrator).up({
        root: "/project",
        env: "production",
        entry: { root: "/project", server: "" },
        resources: {
          hasDatabase: false,
          hasBucket: false,
          hasAnalytics: false,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
        },
        run: Object.assign(
          async (task: { handler: () => Promise<unknown> }) =>
            await task.handler(),
          { end: () => {} },
        ) as never,
      });

    return { alepha, shell, events, up };
  };

  it("names its own class, and keeps the options as given", () => {
    expect(lore({ project: "alepha" })).toEqual({
      adapter: LoreAdapter,
      options: { project: "alepha" },
    });
    expect(lore().options).toEqual({});
  });

  it("seals the secrets before the run starts, after the push", async () => {
    const { events, up } = await create();

    const result = await up();

    expect(events).toEqual([
      "push docs@latest",
      "secret APP_SECRET on inst-1",
      "start latest",
    ]);
    // Lore's own address for the run; the config names no domain to echo.
    expect(result.urls).toEqual(["https://docs.alepha.dev"]);
    expect(result.domain).toBeUndefined();
  });

  it("never writes SIGIL_KEY, nor a name Lore reserves", async () => {
    const { events, up } = await create();

    await up();

    const keys = events.filter((it) => it.startsWith("secret"));
    expect(keys).toEqual(["secret APP_SECRET on inst-1"]);
  });

  it("builds the runtime the copy's estate accepts, with the running binary", async () => {
    const { shell, up } = await create();

    await up();

    expect(shell.calls).toHaveLength(1);
    const command = shell.calls[0].command;
    expect(command.endsWith(" build --runtime workerd")).toBe(true);
    expect(command.startsWith(JSON.stringify(process.execPath))).toBe(true);
    expect(command).not.toContain("npx");
  });

  it("refuses a copy that does not exist, before building anything", async () => {
    const { shell, events, up } = await create({ instance: null });

    await expect(up()).rejects.toThrow(
      /docs\/production is not a deployed copy of this project/,
    );
    expect(shell.calls).toEqual([]);
    expect(events).toEqual([]);
  });

  it("refuses an environment that names no project, in config or LORE_PROJECT", async () => {
    const { up } = await create({ descriptor: lore() });

    await expect(up()).rejects.toThrow(/names no Lore project/);
  });

  it("takes the project from LORE_PROJECT when lore() is given none", async () => {
    const { events, up } = await create({
      descriptor: lore(),
      env: { LORE_PROJECT: "alepha" },
    });

    await up();

    expect(events.at(-1)).toBe("start latest");
  });

  describe("url", () => {
    it("reaches the client when LORE_URL is unset", async () => {
      const { alepha, up } = await create({
        descriptor: lore({
          project: "alepha",
          url: "https://lore.example.com",
        }),
      });

      await up();

      expect(alepha.inject(LoreClientService).hostname()).toBe(
        "https://lore.example.com",
      );
    });

    it("loses to LORE_URL, so CI needs no edit to the config", async () => {
      const { alepha, up } = await create({
        descriptor: lore({
          project: "alepha",
          url: "https://lore.example.com",
        }),
        env: { LORE_URL: "https://lore.self-hosted.test" },
      });

      await up();

      expect(alepha.inject(LoreClientService).hostname()).toBe(
        "https://lore.self-hosted.test",
      );
    });
  });
});
