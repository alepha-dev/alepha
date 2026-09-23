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
      instance?:
        | (Record<string, unknown> & { app?: string; env?: string })
        | null;
      /**
       * What Lore's destroy answers, or `undefined` to answer every resource
       * removed.
       */
      /**
       * The estates lent to the project, newest first as Lore lists them.
       */
      lent?: Array<{ id: string; slug: string; acceptedRuntimes?: string[] }>;
      /**
       * What `getApp` throws instead of answering, other than the 404 of a
       * missing copy.
       */
      readError?: unknown;
      destroyed?: {
        removed: string[];
        kept: string[];
        failed: Array<{ resource: string; message: string }>;
      };
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
        "tmp-pr-1": lore({ project: "alepha" }),
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
    const printed: string[] = [];
    const log = {
      info: (message: string) => printed.push(message),
      warn: (message: string) => printed.push(message),
      error: () => {},
      debug: () => {},
      trace: () => {},
    };
    let instance =
      options.instance === undefined
        ? { id: "inst-1", estateId: "cf-1" }
        : options.instance;
    const lent = options.lent ?? [
      { id: "cf-1", slug: "first", acceptedRuntimes: ["workerd"] },
    ];

    Object.assign(alepha.inject(LoreDeployer) as unknown as object, {
      apps: {
        getApp: async () => {
          if (options.readError) {
            throw options.readError;
          }
          if (!instance) {
            throw new HttpError({ status: 404, message: "App not found" });
          }
          return instance;
        },
        createApp: async ({ body }: { body: Record<string, unknown> }) => {
          events.push(`create ${JSON.stringify(body)}`);
          instance = { id: "inst-new", app: "docs", env: "production" };
          return instance;
        },
        updateApp: async ({ body }: { body: { estateId: string } }) => {
          events.push(`link ${body.estateId}`);
          instance = { ...instance, estateId: body.estateId };
          return instance;
        },
        // Lore's own check: the confirmation must be the copy's `app/env` as
        // the ROW spells it, which is what makes a written one safe only when
        // it names this copy.
        destroyAppResources: async ({
          params,
          body,
        }: {
          params: { app: string; env: string };
          body: { confirm: string };
        }) => {
          const expected = `${instance?.app ?? params.app}/${instance?.env ?? params.env}`;
          if (body.confirm !== expected) {
            throw new HttpError({
              status: 400,
              message: `Type "${expected}" to confirm.`,
            });
          }
          events.push(`destroy ${body.confirm}`);
          return (
            options.destroyed ?? {
              removed: ["worker", "queue"],
              kept: ["database", "bucket"],
              failed: [],
            }
          );
        },
      },
      estates: {
        listProjectEstates: async () => ({
          items: lent.map((it) => ({ acceptedRuntimes: ["workerd"], ...it })),
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
        listAppSecrets: async () => ({
          items: [{ id: "1", key: "APP_SECRET", valuePrefix: "s3" }],
        }),
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
    Object.assign(alepha.inject(LoreDeployer) as unknown as object, { log });
    Object.assign(alepha.inject(LoreAdapter) as unknown as object, {
      projects: { resolve: async () => 1 },
      log,
    });

    const parts = {
      root: "/project",
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
    };
    const orchestrator = alepha.inject(PlatformOrchestrator);

    const up = () => orchestrator.up({ ...parts, env: "production" });
    /**
     * `alepha platform down`, as `--yes` answers its prompt: with the env's
     * own name, which is what a typed confirmation would have been.
     */
    const down = (env = "production") =>
      orchestrator.down({ ...parts, env, confirm: async () => env });
    const status = () => orchestrator.status({ ...parts, env: "production" });

    return { alepha, shell, events, printed, up, down, status };
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

  describe("down", () => {
    const aCopy = (extra: Record<string, unknown> = {}) => ({
      id: "inst-1",
      estateId: "cf-1",
      app: "docs",
      env: "production",
      ...extra,
    });

    it("tears down a copy that keeps its data, confirming it as Lore requires", async () => {
      const { events, printed, down } = await create({ instance: aCopy() });

      expect(await down()).toBe(true);

      expect(events).toEqual(["destroy docs/production"]);
      expect(printed).toContain("Removed worker, queue for docs/production");
      // Said on every run: the data survives, and the operator reads so.
      expect(printed).toContain("Kept: database, bucket");
    });

    it("refuses an ephemeral copy even under --yes, naming the command that can", async () => {
      const { events, down } = await create({
        instance: aCopy({ ephemeral: true }),
      });

      await expect(down()).rejects.toThrow(
        /EPHEMERAL.*lore apps destroy --app docs --env production --confirm docs\/production/,
      );
      expect(events).toEqual([]);
    });

    it("refuses an ephemeral copy on a tmp env too, where the platform never prompts", async () => {
      const { events, down } = await create({
        instance: aCopy({ env: "tmp-pr-1", ephemeral: true }),
      });

      await expect(down("tmp-pr-1")).rejects.toThrow(/EPHEMERAL/);
      expect(events).toEqual([]);
    });

    it("reports a resource that failed, and exits non-zero", async () => {
      const { printed, down } = await create({
        instance: aCopy(),
        destroyed: {
          removed: ["worker"],
          kept: ["database"],
          failed: [{ resource: "queue", message: "still has consumers" }],
        },
      });

      await expect(down()).rejects.toThrow(
        /1 resource\(s\) could not be removed/,
      );
      expect(printed).toContain("queue was not removed: still has consumers");
    });

    it("is refused by Lore when the written confirmation does not name the row", async () => {
      // The config says `production`; the row Lore holds is `prod`. A written
      // confirmation is only safe because Lore checks it against the ROW.
      const { events, down } = await create({
        instance: aCopy({ env: "prod" }),
      });

      await expect(down()).rejects.toThrow(/Type "docs\/prod" to confirm/);
      expect(events).toEqual([]);
    });
  });

  describe("status", () => {
    it("prints the copy in the shape every adapter's status has", async () => {
      const { status } = await create({
        instance: {
          id: "inst-1",
          estateId: "cf-1",
          url: "https://docs.alepha.dev",
          resourceName: "alepha-docs-production",
          version: "0.29.0",
          estate: { slug: "alepha-cf" },
        },
      });

      const { state } = await status();

      expect(state.workers).toEqual([
        {
          name: "alepha-docs-production",
          exists: true,
          id: "inst-1",
          tag: "0.29.0",
          createdAt: undefined,
          detail: "https://docs.alepha.dev on estate 'alepha-cf'",
        },
      ]);
      expect(state.secrets).toEqual([{ name: "APP_SECRET", deployed: true }]);
      expect(state.databases).toEqual([]);
    });

    it("says a missing copy does not exist, rather than failing", async () => {
      const { status } = await create({ instance: null });

      const { state } = await status();

      expect(state.workers).toEqual([
        {
          name: "docs/production",
          exists: false,
          detail: "not a deployed copy of this project",
        },
      ]);
    });
  });

  describe("a first up", () => {
    it("creates the missing copy on the estate lent first, then deploys to it", async () => {
      const { events, printed, up } = await create({
        instance: null,
        // Newest first, as Lore lists them: the one lent FIRST is the last.
        lent: [
          { id: "cf-2", slug: "newer" },
          { id: "cf-1", slug: "first" },
        ],
      });

      await up();

      expect(events).toEqual([
        // Nothing optional: no domain, not ephemeral, no sigil.
        'create {"app":"docs","env":"production"}',
        "link cf-1",
        "push docs@latest",
        "secret APP_SECRET on inst-new",
        "start latest",
      ]);
      expect(printed).toContain("Created docs/production on estate 'first'");
    });

    it("creates it on the estate lore() names", async () => {
      const { events, up } = await create({
        instance: null,
        descriptor: lore({ project: "alepha", estate: "newer" }),
        lent: [
          { id: "cf-2", slug: "newer" },
          { id: "cf-1", slug: "first" },
        ],
      });

      await up();

      expect(events).toContain("link cf-2");
    });

    it("refuses when no estate is lent, and creates nothing", async () => {
      const { events, shell, up } = await create({ instance: null, lent: [] });

      await expect(up()).rejects.toThrow(/No estate is lent to this project/);
      expect(events).toEqual([]);
      expect(shell.calls).toEqual([]);
    });

    it("refuses an estate the project was not lent, before creating anything", async () => {
      const { events, up } = await create({
        instance: null,
        descriptor: lore({ project: "alepha", estate: "elsewhere" }),
      });

      await expect(up()).rejects.toThrow(/No estate called 'elsewhere'/);
      expect(events).toEqual([]);
    });

    it("rethrows a 403 and creates nothing: only a 404 means missing", async () => {
      const { events, shell, up } = await create({
        readError: new HttpError({ status: 403, message: "Forbidden" }),
      });

      await expect(up()).rejects.toThrow(/Forbidden/);
      expect(events).toEqual([]);
      expect(shell.calls).toEqual([]);
    });
  });
});
