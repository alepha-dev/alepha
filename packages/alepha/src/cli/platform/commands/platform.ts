import { $inject, $state, AlephaError, z } from "alepha";
import { type AppEntry, AppEntryProvider, ViteBuildProvider } from "alepha/cli";
import {
  CloudflareAdapter,
  type DetectedResources,
  NamingService,
  type PlatformContext,
  PlatformInspector,
  PlatformOrchestrator,
  type PlatformPlanOutput,
  type PlatformStatusOutput,
  platformOptions,
  type ResolvedPlatformConfig,
  resolveTenant,
  VercelAdapter,
  WranglerApi,
} from "alepha/cli/platform-lib";
import { $command, EnvUtils, type RunnerMethod } from "alepha/command";
import { $logger, ConsoleColorProvider } from "alepha/logger";
import { SecretsCommand } from "./SecretsCommand.ts";

export class PlatformCommand {
  protected readonly log = $logger();
  protected readonly options = $state(platformOptions);
  protected readonly orchestrator = $inject(PlatformOrchestrator);
  protected readonly inspector = $inject(PlatformInspector);
  protected readonly naming = $inject(NamingService);
  protected readonly boot = $inject(AppEntryProvider);
  protected readonly viteBuild = $inject(ViteBuildProvider);
  protected readonly color = $inject(ConsoleColorProvider);
  protected readonly envUtils = $inject(EnvUtils);
  protected readonly secretsCommand = $inject(SecretsCommand);
  protected readonly wrangler = $inject(WranglerApi);

  /**
   * Common flags for env targeting.
   */
  protected readonly envFlags = z.object({
    env: z
      .text({
        aliases: ["e"],
        description: "Target environment",
      })
      .optional(),
    tenant: z
      .text({
        description:
          "Tenant slug (apps with tenancy: optional | required). Names resources <tenant>-<project>-<env> and serves <tenant>.<domain>.",
      })
      .optional(),
    verbose: z
      .boolean()
      .meta({ aliases: ["v"] })
      .describe("Verbose output")
      .optional(),
    json: z.boolean().describe("Output as JSON").optional(),
  });

  // -----------------------------------------------------------------------
  // alepha p plan
  // -----------------------------------------------------------------------

  protected readonly plan = $command({
    name: "plan",
    description: "Show project topology and resource names",
    flags: this.envFlags,
    handler: async ({ flags, root }) => {
      const config = await this.inspector.resolveConfig(root);
      const env = flags.env ?? config.defaultEnv;
      const envConfig = config.environments[env];
      const adapterName = envConfig?.adapter ?? "cloudflare";

      const apps = await this.resolveApps(
        root,
        config,
        this.isServerless(adapterName),
      );
      const tenant = resolveTenant(config.tenancy, flags.tenant);
      const namingCtx = this.naming.forContext(config.project, env, tenant);

      // --- Data collection ---

      const hasDB = apps.some((a) => a.resources.hasDatabase);
      const hasBucket = apps.some((a) => a.resources.hasBucket);
      const envVars = await this.envUtils.parseEnv(root, [`.env.${env}`]);

      const resources: Array<{ label: string; value: string }> = [];

      const deployLabel = adapterName === "vercel" ? "Project" : "Worker";
      resources.push({ label: deployLabel, value: namingCtx.worker() });

      if (adapterName === "cloudflare") {
        if (hasDB) {
          const dbUrl = envVars.DATABASE_URL ?? process.env.DATABASE_URL;
          if (dbUrl?.startsWith("postgres:")) {
            resources.push({
              label: "Hyperdrive",
              value: namingCtx.hyperdrive(),
            });
          } else {
            resources.push({ label: "D1", value: namingCtx.d1() });
          }
        }

        if (hasBucket) {
          resources.push({ label: "R2", value: namingCtx.r2() });
        }

        for (const app of apps) {
          if (app.resources.hasKV) {
            resources.push({ label: "KV", value: namingCtx.kv() });
          }
          if (app.resources.hasQueue) {
            resources.push({ label: "Queue", value: namingCtx.queue() });
          }
        }
      }

      const excludedKeys =
        adapterName === "vercel"
          ? VercelAdapter.EXCLUDED_SECRET_KEYS
          : CloudflareAdapter.EXCLUDED_SECRET_KEYS;
      const secretCount = Object.entries(envVars).filter(
        ([key, value]) =>
          value && !excludedKeys.has(key) && !key.startsWith("VITE_"),
      ).length;

      // --- JSON output ---

      if (flags.json) {
        const environments: Record<
          string,
          { adapter: string; domain?: string }
        > = {};
        for (const [key, val] of Object.entries(config.environments)) {
          environments[key] = {
            adapter: val.adapter,
            ...(val.domain ? { domain: val.domain } : {}),
          };
        }

        const output: PlatformPlanOutput = {
          project: config.project,
          env,
          mode: "standalone",
          apps: apps.map((a) => ({
            name: a.name,
            path: a.path,
            resources: a.resources,
          })),
          environments,
          resources,
          secretCount,
        };

        process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
        return;
      }

      // --- Tree output ---

      const c = this.color;

      process.stdout.write(
        `\n\u{1F4E6} ${c.set("WHITE_BOLD", config.project)} ${c.set("GREY_DARK", "\u2014")} ${c.set("CYAN", env)}\n\n`,
      );

      process.stdout.write(`   ${c.set("GREY_LIGHT", "Mode:")} standalone\n`);

      process.stdout.write(`\n   ${c.set("GREY_LIGHT", "Environments:")}\n`);
      const envKeys = Object.keys(config.environments);
      for (const [i, envKey] of envKeys.entries()) {
        const envConfig = config.environments[envKey];
        const prefix =
          i === envKeys.length - 1
            ? "\u2514\u2500\u2500"
            : "\u251C\u2500\u2500";
        const domain = envConfig.domain
          ? `     ${c.set("GREY_DARK", envConfig.domain)}`
          : "";
        const marker = envKey === env ? `  ${c.set("GREEN", "\u25C0")}` : "";
        process.stdout.write(
          `   ${c.set("GREY_DARK", prefix)} ${c.set("CYAN", envKey.padEnd(10))} ${c.set("GREY_LIGHT", envConfig.adapter)}${domain}${marker}\n`,
        );
      }

      process.stdout.write(`\n   ${c.set("GREY_LIGHT", "Resources:")}\n`);

      if (secretCount > 0) {
        resources.push({
          label: "Secrets",
          value: `${secretCount} from .env.${env}`,
        });
      }

      for (const [i, res] of resources.entries()) {
        const isLast = i === resources.length - 1;
        const branch = isLast ? "\u2514\u2500\u2500" : "\u251C\u2500\u2500";
        process.stdout.write(
          `   ${c.set("GREY_DARK", branch)} ${c.set("GREY_LIGHT", res.label.padEnd(11))} ${c.set("CYAN", res.value)}\n`,
        );
      }

      process.stdout.write("\n");
    },
  });

  // -----------------------------------------------------------------------
  // alepha p up
  // -----------------------------------------------------------------------

  protected readonly up = $command({
    name: "up",
    mode: "production",
    description: "Build, migrate, and deploy",
    flags: z.object({
      ...this.envFlags.properties,
      prebuilt: z
        .boolean()
        .describe(
          "Pre-built mode. Skips the Vite bundle steps; only regenerates the target deploy config (wrangler.jsonc) so it reflects current bindings and per-tenant overrides. Use when `dist/` is already produced upstream (e.g. inside Alepha Rocket).",
        )
        .optional(),
    }),
    handler: async ({ flags, root, run }) => {
      process.env.NODE_ENV = "production";

      const config = await this.inspector.resolveConfig(root);
      const env = flags.env ?? config.defaultEnv;
      const adapter = config.environments[env]?.adapter ?? "cloudflare";
      const apps = await this.resolveApps(
        root,
        config,
        this.isServerless(adapter),
        { prebuilt: flags.prebuilt },
      );

      const result = await this.orchestrator.up({
        root,
        env,
        entry: apps[0].entry,
        resources: apps[0].resources,

        run,
        prebuilt: flags.prebuilt,
        tenant: flags.tenant,
      });

      if (flags.json) {
        process.stdout.write(
          `${JSON.stringify(
            {
              status: "succeeded",
              project: config.project,
              env,
              urls: result.urls,
              domain: result.domain,
            },
            null,
            2,
          )}\n`,
        );
      } else {
        this.orchestrator.printUpSummary(result);
      }
    },
  });

  // -----------------------------------------------------------------------
  // alepha p down
  // -----------------------------------------------------------------------

  protected readonly down = $command({
    name: "down",
    description: "Tear down an environment",
    flags: z.object({
      ...this.envFlags.properties,
      yes: z
        .boolean()
        .meta({ aliases: ["y"] })
        .describe(
          "Skip the interactive confirmation. Required for non-interactive callers (CI, Alepha Rocket). The caller is responsible for not invoking this accidentally — there's no second chance.",
        )
        .optional(),
    }),
    handler: async ({ flags, root, run, ask }) => {
      if (!flags.env) {
        throw new AlephaError(
          "--env is required for teardown. This command deletes resources.",
        );
      }

      const config = await this.inspector.resolveConfig(root);
      const adapter = config.environments[flags.env]?.adapter ?? "cloudflare";
      const apps = await this.resolveApps(
        root,
        config,
        this.isServerless(adapter),
      );

      const completed = await this.orchestrator.down({
        root,
        env: flags.env,
        entry: apps[0].entry,
        resources: apps[0].resources,

        run,
        tenant: flags.tenant,
        confirm: async (prompt) => {
          if (flags.yes) {
            return flags.env as string;
          }
          ask.intro("Confirm teardown");
          const value = await ask(prompt);
          ask.outro("");
          return value;
        },
      });

      if (flags.json) {
        process.stdout.write(
          `${JSON.stringify(
            {
              status: completed ? "succeeded" : "aborted",
              project: config.project,
              env: flags.env,
            },
            null,
            2,
          )}\n`,
        );
      }
    },
  });

  // -----------------------------------------------------------------------
  // alepha platform auth login|logout
  // -----------------------------------------------------------------------

  /**
   * Runs the adapter's interactive login or logout.
   *
   * Shared by both subcommands: they differ by one word, and duplicating the
   * environment resolution would let them drift.
   */
  protected async runAuth(
    action: "login" | "logout",
    ctx: { flags: { env?: string }; root: string; run: RunnerMethod },
  ): Promise<void> {
    if (!ctx.flags.env) {
      // Credentials are per-environment because environments can live on
      // different hosts or accounts; guessing one would log into the wrong
      // place with no sign that it happened.
      throw new AlephaError(
        "--env is required: each environment has its own credential.",
      );
    }
    const config = await this.inspector.resolveConfig(ctx.root);
    const apps = await this.resolveApps(
      ctx.root,
      config,
      this.isServerless(
        config.environments[ctx.flags.env]?.adapter ?? "cloudflare",
      ),
    );
    await this.orchestrator.auth({
      root: ctx.root,
      env: ctx.flags.env,
      entry: apps[0].entry,
      resources: apps[0].resources,
      run: ctx.run,
      action,
    });
  }

  /**
   * `alepha platform auth login`.
   *
   * The mechanism belongs to the adapter — `wrangler login` for Cloudflare, a
   * device-code flow for Bay — because credentials are the provider's
   * vocabulary, and a second store would drift from the one every other tool
   * reads.
   *
   * Separate from `up`, which must never block: it runs in CI, where nothing
   * can answer a prompt. This is what a human runs once.
   */
  protected readonly authLogin = $command({
    name: "login",
    description: "Log in to the platform for an environment",
    flags: this.envFlags,
    handler: async ({ flags, root, run }) =>
      await this.runAuth("login", { flags, root, run }),
  });

  /**
   * `alepha platform auth logout`.
   */
  protected readonly authLogout = $command({
    name: "logout",
    description: "Discard the stored credential for an environment",
    flags: this.envFlags,
    handler: async ({ flags, root, run }) =>
      await this.runAuth("logout", { flags, root, run }),
  });

  protected readonly auth = $command({
    name: "auth",
    description: "Manage platform credentials",
    children: [this.authLogin, this.authLogout],
    handler: async ({ help }) => {
      help();
    },
  });

  // -----------------------------------------------------------------------
  // alepha p status
  // -----------------------------------------------------------------------

  protected readonly status = $command({
    name: "status",
    aliases: ["s"],
    description: "Show deployed state",
    flags: this.envFlags,
    handler: async ({ flags, root, run }) => {
      const config = await this.inspector.resolveConfig(root);
      const env = flags.env ?? config.defaultEnv;
      const adapter = config.environments[env]?.adapter ?? "cloudflare";
      const apps = await this.resolveApps(
        root,
        config,
        this.isServerless(adapter),
      );

      const { state } = await this.orchestrator.status({
        root,
        env,
        entry: apps[0].entry,
        resources: apps[0].resources,

        run,
        tenant: flags.tenant,
      });

      // --- JSON output ---

      if (flags.json) {
        run.end();

        const output: PlatformStatusOutput = {
          project: config.project,
          env,
          adapter: config.environments[env].adapter,
          ...state,
        };

        process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
        return;
      }

      // --- Tree output ---

      run.end();

      const c = this.color;

      process.stdout.write(
        `\n\u{1F4E6} ${c.set("WHITE_BOLD", config.project)} ${c.set("GREY_DARK", "\u2014")} ${c.set("CYAN", env)} ${c.set("GREY_DARK", `(${config.environments[env].adapter})`)}\n\n`,
      );

      const hasDB = state.databases.length > 0;
      const hasBuckets = state.buckets.length > 0;

      process.stdout.write(`   ${c.set("GREY_LIGHT", "Workers:")}\n`);
      for (const [i, w] of state.workers.entries()) {
        const isLast = i === state.workers.length - 1;
        const branch = isLast ? "\u2514\u2500\u2500" : "\u251C\u2500\u2500";
        if (w.exists) {
          const versionShort = w.version?.slice(0, 8) ?? "unknown";
          const tag = w.tag ? ` ${c.set("GREY_DARK", `(${w.tag})`)}` : "";
          const date = w.createdAt
            ? ` ${c.set("GREY_DARK", "\u2014")} ${c.set("GREY_DARK", new Date(w.createdAt).toLocaleString())}`
            : "";
          process.stdout.write(
            `   ${c.set("GREY_DARK", branch)} ${c.set("CYAN", w.name)}  ${c.set("GREEN", "\u2713")} ${c.set("GREY_LIGHT", versionShort)}${tag}${date}\n`,
          );
        } else {
          process.stdout.write(
            `   ${c.set("GREY_DARK", branch)} ${c.set("CYAN", w.name)}  ${c.set("RED", "\u2717")} ${c.set("RED", "not deployed")}\n`,
          );
        }
      }

      if (hasDB) {
        const envVars = await this.envUtils.parseEnv(root, [`.env.${env}`]);
        const dbUrl = envVars.DATABASE_URL ?? process.env.DATABASE_URL;
        const dbLabel = dbUrl?.startsWith("postgres:")
          ? "Hyperdrive:"
          : "Database:";
        process.stdout.write(`\n   ${c.set("GREY_LIGHT", dbLabel)}\n`);
        for (const [i, db] of state.databases.entries()) {
          const isLast = i === state.databases.length - 1;
          const branch = isLast ? "\u2514\u2500\u2500" : "\u251C\u2500\u2500";
          if (db.exists) {
            const id = db.id
              ? ` ${c.set("GREY_LIGHT", db.id.slice(0, 8))}`
              : "";
            const detail = db.detail
              ? ` ${c.set("GREY_DARK", "\u2014")} ${c.set("GREY_DARK", db.detail.slice(0, 40))}`
              : "";
            process.stdout.write(
              `   ${c.set("GREY_DARK", branch)} ${c.set("CYAN", db.name)}  ${c.set("GREEN", "\u2713")}${id}${detail}\n`,
            );
          } else {
            process.stdout.write(
              `   ${c.set("GREY_DARK", branch)} ${c.set("CYAN", db.name)}  ${c.set("RED", "\u2717")} ${c.set("RED", "not provisioned")}\n`,
            );
          }
        }
      }

      if (hasBuckets) {
        process.stdout.write(`\n   ${c.set("GREY_LIGHT", "Buckets:")}\n`);
        for (const [i, b] of state.buckets.entries()) {
          const isLast = i === state.buckets.length - 1;
          const branch = isLast ? "\u2514\u2500\u2500" : "\u251C\u2500\u2500";
          if (b.exists) {
            process.stdout.write(
              `   ${c.set("GREY_DARK", branch)} ${c.set("CYAN", b.name)}  ${c.set("GREEN", "\u2713")}\n`,
            );
          } else {
            process.stdout.write(
              `   ${c.set("GREY_DARK", branch)} ${c.set("CYAN", b.name)}  ${c.set("RED", "\u2717")} ${c.set("RED", "not provisioned")}\n`,
            );
          }
        }
      }

      if (state.kvNamespaces.length > 0) {
        process.stdout.write(`\n   ${c.set("GREY_LIGHT", "KV:")}\n`);
        for (const [i, kv] of state.kvNamespaces.entries()) {
          const isLast = i === state.kvNamespaces.length - 1;
          const branch = isLast ? "\u2514\u2500\u2500" : "\u251C\u2500\u2500";
          if (kv.exists) {
            const id = kv.id
              ? ` ${c.set("GREY_LIGHT", kv.id.slice(0, 8))}`
              : "";
            process.stdout.write(
              `   ${c.set("GREY_DARK", branch)} ${c.set("CYAN", kv.name)}  ${c.set("GREEN", "\u2713")}${id}\n`,
            );
          } else {
            process.stdout.write(
              `   ${c.set("GREY_DARK", branch)} ${c.set("CYAN", kv.name)}  ${c.set("RED", "\u2717")} ${c.set("RED", "not provisioned")}\n`,
            );
          }
        }
      }

      if (state.queues.length > 0) {
        process.stdout.write(`\n   ${c.set("GREY_LIGHT", "Queues:")}\n`);
        for (const [i, q] of state.queues.entries()) {
          const isLast = i === state.queues.length - 1;
          const branch = isLast ? "\u2514\u2500\u2500" : "\u251C\u2500\u2500";
          if (q.exists) {
            const id = q.id ? ` ${c.set("GREY_LIGHT", q.id.slice(0, 8))}` : "";
            process.stdout.write(
              `   ${c.set("GREY_DARK", branch)} ${c.set("CYAN", q.name)}  ${c.set("GREEN", "\u2713")}${id}\n`,
            );
          } else {
            process.stdout.write(
              `   ${c.set("GREY_DARK", branch)} ${c.set("CYAN", q.name)}  ${c.set("RED", "\u2717")} ${c.set("RED", "not provisioned")}\n`,
            );
          }
        }
      }

      if (state.secrets.length > 0) {
        process.stdout.write(`\n   ${c.set("GREY_LIGHT", "Secrets:")}\n`);
        for (const [i, s] of state.secrets.entries()) {
          const isLast = i === state.secrets.length - 1;
          const branch = isLast ? "\u2514\u2500\u2500" : "\u251C\u2500\u2500";
          const icon = s.deployed
            ? c.set("GREEN", "\u2713")
            : c.set("RED", "\u2717");
          process.stdout.write(
            `   ${c.set("GREY_DARK", branch)} ${c.set("CYAN", s.name)}  ${icon}\n`,
          );
        }
      }

      process.stdout.write("\n");
    },
  });

  // -----------------------------------------------------------------------
  // Granular commands
  // -----------------------------------------------------------------------

  protected readonly build = $command({
    name: "build",
    mode: "production",
    description: "Build all apps locally",
    flags: this.envFlags,
    handler: async ({ flags, root, run }) => {
      process.env.NODE_ENV = "production";
      const config = await this.inspector.resolveConfig(root);
      const env = flags.env ?? config.defaultEnv;
      const envConfig = config.environments[env];
      const adapter = this.orchestrator.resolveAdapter(envConfig.adapter);
      const apps = await this.resolveApps(
        root,
        config,
        this.isServerless(envConfig.adapter),
      );
      const tenant = resolveTenant(config.tenancy, flags.tenant);
      const namingCtx = this.naming.forContext(config.project, env, tenant);

      const ctx = {
        project: config.project,
        env,
        envConfig,
        entry: apps[0].entry,
        resources: apps[0].resources,

        root,
        naming: namingCtx,
        tenant,
      };

      await adapter.build(ctx, run);
    },
  });

  protected readonly deploy = $command({
    name: "deploy",
    description: "Deploy apps to cloud",
    flags: this.envFlags,
    handler: async ({ flags, root, run }) => {
      const config = await this.inspector.resolveConfig(root);
      const env = flags.env ?? config.defaultEnv;
      const envConfig = config.environments[env];
      const adapter = this.orchestrator.resolveAdapter(envConfig.adapter);
      const apps = await this.resolveApps(
        root,
        config,
        this.isServerless(envConfig.adapter),
      );
      const tenant = resolveTenant(config.tenancy, flags.tenant);
      const namingCtx = this.naming.forContext(config.project, env, tenant);

      const ctx = {
        project: config.project,
        env,
        envConfig,
        entry: apps[0].entry,
        resources: apps[0].resources,

        root,
        naming: namingCtx,
        tenant,
      };

      await adapter.authenticate(ctx, run);
      await adapter.deploy(ctx, run);
    },
  });

  protected readonly migrate = $command({
    name: "migrate",
    description: "Run database migrations",
    flags: this.envFlags,
    handler: async ({ flags, root, run }) => {
      const config = await this.inspector.resolveConfig(root);
      const env = flags.env ?? config.defaultEnv;
      const envConfig = config.environments[env];
      const adapter = this.orchestrator.resolveAdapter(envConfig.adapter);
      const apps = await this.resolveApps(
        root,
        config,
        this.isServerless(envConfig.adapter),
      );
      const tenant = resolveTenant(config.tenancy, flags.tenant);
      const namingCtx = this.naming.forContext(config.project, env, tenant);

      const ctx = {
        project: config.project,
        env,
        envConfig,
        entry: apps[0].entry,
        resources: apps[0].resources,

        root,
        naming: namingCtx,
        tenant,
      };

      await adapter.authenticate(ctx, run);
      await adapter.migrate(ctx, run);

      if (flags.json) {
        process.stdout.write(
          `${JSON.stringify(
            { status: "succeeded", project: config.project, env },
            null,
            2,
          )}\n`,
        );
      }
    },
  });

  protected readonly dbExport = $command({
    name: "export",
    description:
      "Export the deployed database to a local snapshot (remote → local dev DB).",
    flags: z.object({
      ...this.envFlags.properties,
      output: z
        .text({
          description:
            "Destination SQLite file. Defaults to the dev DB path (node_modules/.alepha/sqlite.db).",
        })
        .optional(),
      keepSql: z
        .boolean()
        .describe("Keep the intermediate .sql dump file.")
        .optional(),
    }),
    handler: async ({ flags, root, run }) => {
      const config = await this.inspector.resolveConfig(root);
      const env = flags.env ?? config.defaultEnv;
      const envConfig = config.environments[env];
      const adapter = this.orchestrator.resolveAdapter(envConfig.adapter);
      const app = await this.resolveApp(
        root,
        config,
        this.isServerless(envConfig.adapter),
      );
      const tenant = resolveTenant(config.tenancy, flags.tenant);
      const namingCtx = this.naming.forContext(config.project, env, tenant);

      const ctx = {
        project: config.project,
        env,
        envConfig,
        entry: app.entry,
        resources: app.resources,

        root,
        naming: namingCtx,
        tenant,
      };

      await adapter.authenticate(ctx, run);
      await adapter.exportDb(ctx, run, {
        output: flags.output,
        keepSql: flags.keepSql,
      });
    },
  });

  /**
   * Record the baseline migration as already applied on a deployed
   * Cloudflare D1 database, without executing it.
   *
   * D1's deploy path doesn't go through drizzle's migrator at all — it
   * keys off a filename-based `d1_migrations` bookkeeping table driven by
   * wrangler (see `WranglerApi.d1MigrationsBaseline`), which needs the
   * project/env/tenant resource naming that only this command tree can
   * resolve. That's also why `--reset` lives here rather than on core
   * `alepha db baseline mark`: it rewrites wrangler's bookkeeping rows
   * only (never table data), and only the D1 path supports it today.
   */
  protected readonly baselineMark = $command({
    name: "mark",
    description:
      "Record the baseline migration as already applied on the deployed D1 database, without executing it.",
    flags: z.object({
      ...this.envFlags.properties,
      reset: z
        .boolean()
        .describe(
          "Replace an existing migration history with the baseline. Rewrites bookkeeping rows only; never touches table data.",
        )
        .optional(),
    }),
    handler: async ({ flags, root, run }) => {
      const config = await this.inspector.resolveConfig(root);
      const env = flags.env ?? config.defaultEnv;
      const envConfig = config.environments[env];

      if (envConfig.adapter !== "cloudflare") {
        throw new AlephaError(
          `'platform db baseline mark' only supports Cloudflare D1 today; '${env}' uses the '${envConfig.adapter}' adapter.`,
        );
      }

      // Deliberately `.env.<env>` only — no `process.env.DATABASE_URL`
      // fallback. Unlike `plan`'s use of the same lookup (a display label
      // only), this gates a hard refusal: a deployed D1 environment's
      // `DATABASE_URL` is a Cloudflare secret, not a local env var, so it's
      // routinely absent from `.env.<env>` — and falling back to whatever
      // the operator happens to have exported would make this guard trip on
      // an unrelated local Postgres database, sending a real D1 deploy to
      // `alepha db baseline mark`, which then hard-refuses D1 with no
      // working path left.
      const envVars = await this.envUtils.parseEnv(root, [`.env.${env}`]);
      if (envVars.DATABASE_URL?.startsWith("postgres:")) {
        throw new AlephaError(
          `'${env}' is backed by Postgres/Hyperdrive, not D1. Use 'alepha db baseline mark' instead.`,
        );
      }

      const adapter = this.orchestrator.resolveAdapter(envConfig.adapter);
      const tenant = resolveTenant(config.tenancy, flags.tenant);
      const namingCtx = this.naming.forContext(config.project, env, tenant);
      const dbName = namingCtx.d1();

      // No app boot needed below this point — unlike `migrate`/`export`,
      // this command never calls an adapter method that reads `entry` or
      // `resources`, so those are stubbed rather than paying for a Vite
      // boot (or requiring dist/manifest.json) just to baseline-mark.
      const ctx: PlatformContext = {
        project: config.project,
        env,
        envConfig,
        root,
        entry: { root, server: "" },
        resources: {
          hasDatabase: true,
          hasBucket: false,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
        },
        naming: namingCtx,
        tenant,
      };

      await adapter.authenticate(ctx, run);

      const result = await this.wrangler.d1MigrationsBaseline(
        dbName,
        root,
        undefined,
        { reset: flags.reset },
      );

      if (flags.json) {
        process.stdout.write(
          `${JSON.stringify(
            {
              status: "succeeded",
              project: config.project,
              env,
              dbName,
              replaced: result.replaced,
            },
            null,
            2,
          )}\n`,
        );
      }
    },
  });

  protected readonly baseline = $command({
    name: "baseline",
    description:
      "Record a baseline as already applied on the deployed database (D1 only).",
    children: [this.baselineMark],
    handler: async ({ help }) => {
      help();
    },
  });

  /**
   * `db` subgroup — operations against the *deployed* database (export,
   * migrate, baseline mark). They live under `platform` (not core
   * `alepha db`) because they need the env config, tenancy, adapter, and
   * resource naming.
   */
  protected readonly db = $command({
    name: "db",
    description:
      "Deployed-database operations (export, migrate, baseline mark).",
    children: [this.dbExport, this.migrate, this.baseline],
    handler: async ({ help, root }) => {
      await this.inspector.resolveConfig(root);
      help();
    },
  });

  // -----------------------------------------------------------------------
  // Parent command
  // -----------------------------------------------------------------------

  public readonly platform = $command({
    name: "platform",
    aliases: ["p"],
    description: "Cloud deployment orchestrator",
    children: [
      this.plan,
      this.up,
      this.down,
      this.status,
      this.auth,
      this.build,
      this.deploy,
      this.db,
      this.secretsCommand.secrets,
    ],
    handler: async ({ help, root }) => {
      await this.inspector.resolveConfig(root);
      help();
    },
  });

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /**
   * Resolve app definitions.
   *
   * For standalone: returns a single app from the root.
   * For monorepo: resolves each app path, introspects for resources.
   *
   * NOTE: Resource detection (hasDatabase, hasBucket, etc.) requires
   * ViteBuildProvider.init() per app. This is expensive -- only done
   * for up/down/status, not for plan.
   */
  protected async resolveApp(
    root: string,
    _config: ResolvedPlatformConfig,
    isServerless: boolean,
    options: { prebuilt?: boolean } = {},
  ): Promise<{ entry: AppEntry; resources: DetectedResources }> {
    // Prebuilt + manifest fast-path: read `dist/manifest.json` produced
    // by the original `alepha build` instead of re-booting the workspace
    // via Vite. Lets external orchestrators (Alepha Rocket) avoid the
    // workspace's runtime `npm install` — the app source is never
    // imported here, so missing deps (react-dom, etc.) don't matter.
    if (options.prebuilt) {
      const manifest = await this.readManifest(root);
      if (manifest) {
        return {
          entry: { root, server: "" },
          resources: manifest.resources,
        };
      }
      // No manifest — fall through to introspection. Useful for older
      // artifacts that pre-date the manifest emission.
    }

    const entry = await this.boot.getAppEntry(root);
    if (isServerless) {
      process.env.ALEPHA_SERVERLESS = "true";
    }
    const appAlepha = await this.viteBuild.init({ entry });
    delete process.env.ALEPHA_SERVERLESS;
    const resources = this.detectResources(appAlepha);

    return { entry, resources };
  }

  /**
   * @deprecated single-app projects; use `resolveApp` directly.
   * Kept temporarily so existing commands can be migrated one at a time.
   */
  protected async resolveApps(
    root: string,
    config: ResolvedPlatformConfig,
    isServerless: boolean,
    options: { prebuilt?: boolean } = {},
  ): Promise<
    Array<{
      name: string;
      path: string;
      entry: AppEntry;
      resources: DetectedResources;
    }>
  > {
    const { entry, resources } = await this.resolveApp(
      root,
      config,
      isServerless,
      options,
    );
    return [{ name: config.project, path: "", entry, resources }];
  }

  protected isServerless(adapter: string): boolean {
    return adapter === "vercel" || adapter === "cloudflare";
  }

  /**
   * Read `dist/manifest.json` if present. Returns `null` when the file
   * doesn't exist or isn't parseable — caller falls back to the
   * Vite-introspection path.
   */
  protected async readManifest(root: string): Promise<{
    version: number;
    project: string;
    resources: DetectedResources;
  } | null> {
    try {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const raw = await fs.readFile(
        path.join(root, "dist", "manifest.json"),
        "utf-8",
      );
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  protected detectResources(alepha: any): DetectedResources {
    let hasDatabase = false;
    let hasBucket = false;
    let hasKV = false;
    let hasQueue = false;
    let hasCron = false;

    try {
      const repo = alepha.inject("RepositoryProvider");
      hasDatabase = repo.getRepositories().length > 0;
    } catch {}

    try {
      const storages = alepha.primitives("$storage");
      hasBucket = storages.length > 0;
    } catch {}

    try {
      // Provision KV only when the user actually wants it: a `$cache` declared
      // *without* an explicit `provider` falls back to the runtime default
      // (CloudflareKVProvider on workerd). Any explicit choice — `"memory"`,
      // `DatabaseCacheProvider`, a Redis provider, or a custom one — opts out
      // of the platform default and therefore should not trigger KV
      // provisioning. See platform.ts hasKV docs and `$cache.options.provider`.
      hasKV =
        alepha
          .primitives("cache")
          .filter((it: any) => it.options?.provider == null).length > 0;
    } catch {}

    try {
      hasQueue = alepha.primitives("queue").length > 0;
    } catch {}

    try {
      const cron = alepha.inject("CronProvider");
      hasCron = cron.getCronJobs().length > 0;
    } catch {}

    return { hasDatabase, hasBucket, hasKV, hasQueue, hasCron };
  }
}
