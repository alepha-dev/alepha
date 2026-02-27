import { $inject, $use, AlephaError, t } from "alepha";
import { AppEntryProvider, ViteBuildProvider } from "alepha/cli";
import { $command, EnvUtils } from "alepha/command";
import { $logger, ConsoleColorProvider } from "alepha/logger";
import { CloudflareAdapter } from "../adapters/CloudflareAdapter.ts";
import type {
  AppDefinition,
  DetectedResources,
} from "../adapters/PlatformAdapter.ts";
import { VercelAdapter } from "../adapters/VercelAdapter.ts";
import { platformOptions } from "../atoms/platformOptions.ts";
import type {
  PlatformPlanOutput,
  PlatformStatusOutput,
} from "../schemas/platform.ts";
import { NamingService } from "../services/NamingService.ts";
import {
  PlatformInspector,
  type ResolvedPlatformConfig,
} from "../services/PlatformInspector.ts";
import { PlatformOrchestrator } from "../services/PlatformOrchestrator.ts";
import { SecretsCommand } from "./SecretsCommand.ts";

export class PlatformCommand {
  protected readonly log = $logger();
  protected readonly options = $use(platformOptions);
  protected readonly orchestrator = $inject(PlatformOrchestrator);
  protected readonly inspector = $inject(PlatformInspector);
  protected readonly naming = $inject(NamingService);
  protected readonly boot = $inject(AppEntryProvider);
  protected readonly viteBuild = $inject(ViteBuildProvider);
  protected readonly color = $inject(ConsoleColorProvider);
  protected readonly envUtils = $inject(EnvUtils);
  protected readonly secretsCommand = $inject(SecretsCommand);

  /**
   * Common flags for env/app targeting.
   */
  protected readonly envFlags = t.object({
    env: t.optional(
      t.text({
        aliases: ["e"],
        description: "Target environment",
      }),
    ),
    app: t.optional(
      t.text({
        aliases: ["a"],
        description: "Target specific app (monorepo)",
      }),
    ),
    verbose: t.optional(
      t.boolean({
        aliases: ["v"],
        description: "Verbose output",
      }),
    ),
    json: t.optional(
      t.boolean({
        description: "Output as JSON",
      }),
    ),
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
      const namingCtx = this.naming.forContext(config.project, env);

      // --- Data collection ---

      const hasDB = apps.some((a) => a.resources.hasDatabase);
      const hasBucket = apps.some((a) => a.resources.hasBucket);
      const envVars = await this.envUtils.parseEnv(root, [`.env.${env}`]);

      const resources: Array<{ label: string; value: string }> = [];

      const deployLabel = adapterName === "vercel" ? "Project" : "Worker";
      if (config.isMonorepo) {
        for (const app of apps) {
          resources.push({
            label: deployLabel,
            value: namingCtx.worker(app.name),
          });
        }
      } else {
        resources.push({ label: deployLabel, value: namingCtx.worker() });
      }

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
            resources.push({
              label: "KV",
              value: namingCtx.kv(config.isMonorepo ? app.name : undefined),
            });
          }
          if (app.resources.hasQueue) {
            resources.push({
              label: "Queue",
              value: namingCtx.queue(config.isMonorepo ? app.name : undefined),
            });
          }
        }
      }

      if (adapterName === "docker" || adapterName === "docker-compose") {
        if (hasDB && !envVars.DATABASE_URL) {
          resources.push({ label: "Postgres", value: "postgres:17-alpine" });
        }
        if (hasBucket && !envVars.S3_ENDPOINT) {
          resources.push({ label: "RustFS", value: "rustfs/rustfs:latest" });
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
          mode: config.isMonorepo ? "monorepo" : "standalone",
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

      if (config.isMonorepo) {
        process.stdout.write(
          `   ${c.set("GREY_LIGHT", "Mode:")} monorepo (${config.appPaths.length} apps)\n`,
        );
        for (const [i, appPath] of config.appPaths.entries()) {
          const appName = config.appNames.get(appPath) ?? appPath;
          const prefix =
            i === config.appPaths.length - 1
              ? "\u2514\u2500\u2500"
              : "\u251C\u2500\u2500";
          process.stdout.write(
            `   ${c.set("GREY_DARK", prefix)} ${c.set("CYAN", appName.padEnd(10))} ${c.set("GREY_DARK", appPath)}\n`,
          );
        }
      } else {
        process.stdout.write(`   ${c.set("GREY_LIGHT", "Mode:")} standalone\n`);
      }

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
    flags: this.envFlags,
    handler: async ({ flags, root, run }) => {
      process.env.NODE_ENV = "production";

      const config = await this.inspector.resolveConfig(root);
      const env = flags.env ?? config.defaultEnv;
      const adapter = config.environments[env]?.adapter ?? "cloudflare";
      const apps = await this.resolveApps(
        root,
        config,
        this.isServerless(adapter),
      );

      await this.orchestrator.up({
        root,
        env,
        app: flags.app,
        apps,
        run,
      });
    },
  });

  // -----------------------------------------------------------------------
  // alepha p down
  // -----------------------------------------------------------------------

  protected readonly down = $command({
    name: "down",
    description: "Tear down an environment",
    flags: this.envFlags,
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

      await this.orchestrator.down({
        root,
        env: flags.env,
        app: flags.app,
        apps,
        run,
        confirm: async (prompt) => {
          ask.intro("Confirm teardown");
          const value = await ask(prompt);
          ask.outro("");
          return value;
        },
      });
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
        apps,
        run,
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
      const namingCtx = this.naming.forContext(config.project, env);

      const ctx = {
        project: config.project,
        env,
        envConfig,
        apps,
        root,
        naming: namingCtx,
      };

      const targets = flags.app
        ? apps.filter((a) => a.name === flags.app)
        : apps;

      for (const app of targets) {
        await adapter.build({ ...ctx, app }, run);
      }
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
      const namingCtx = this.naming.forContext(config.project, env);

      const ctx = {
        project: config.project,
        env,
        envConfig,
        apps,
        root,
        naming: namingCtx,
      };

      await adapter.authenticate(ctx, run);

      const targets = flags.app
        ? apps.filter((a) => a.name === flags.app)
        : apps;

      for (const app of targets) {
        await adapter.deploy({ ...ctx, app }, run);
      }
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
      const namingCtx = this.naming.forContext(config.project, env);

      const ctx = {
        project: config.project,
        env,
        envConfig,
        apps,
        root,
        naming: namingCtx,
      };

      await adapter.authenticate(ctx, run);
      await adapter.migrate(ctx, run);
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
      this.build,
      this.deploy,
      this.migrate,
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
  protected async resolveApps(
    root: string,
    config: ResolvedPlatformConfig,
    isServerless: boolean,
  ): Promise<AppDefinition[]> {
    if (!config.isMonorepo) {
      const entry = await this.boot.getAppEntry(root);
      if (isServerless) {
        process.env.ALEPHA_SERVERLESS = "true";
      }
      const appAlepha = await this.viteBuild.init({ entry });
      delete process.env.ALEPHA_SERVERLESS;
      const resources = this.detectResources(appAlepha);

      return [
        {
          name: config.project,
          path: "",
          entry,
          resources,
        },
      ];
    }

    const apps: AppDefinition[] = [];
    for (const appPath of config.appPaths) {
      const appRoot = `${root}/${appPath}`;
      const entry = await this.boot.getAppEntry(appRoot);
      if (isServerless) {
        process.env.ALEPHA_SERVERLESS = "true";
      }
      const appAlepha = await this.viteBuild.init({ entry });
      delete process.env.ALEPHA_SERVERLESS;
      const name = config.appNames.get(appPath) ?? appPath;
      const resources = this.detectResources(appAlepha);

      apps.push({ name, path: appPath, entry, resources });
    }

    return apps;
  }

  protected isServerless(adapter: string): boolean {
    return adapter === "vercel" || adapter === "cloudflare";
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
      const buckets = alepha.primitives("$bucket");
      hasBucket = buckets.length > 0;
    } catch {}

    try {
      hasKV =
        alepha
          .primitives("cache")
          .filter((it: any) => it.options?.provider !== "memory").length > 0;
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
