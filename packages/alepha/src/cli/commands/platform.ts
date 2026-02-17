import { $inject, $use, AlephaError, t } from "alepha";
import { $command } from "alepha/command";
import { $logger, ConsoleColorProvider } from "alepha/logger";
import { platformOptions } from "../atoms/platformOptions.ts";
import type {
  AppDefinition,
  DetectedResources,
} from "../platform/adapters/PlatformAdapter.ts";
import { NamingService } from "../platform/services/NamingService.ts";
import {
  PlatformInspector,
  type ResolvedPlatformConfig,
} from "../platform/services/PlatformInspector.ts";
import { PlatformOrchestrator } from "../platform/services/PlatformOrchestrator.ts";
import { AppEntryProvider } from "../providers/AppEntryProvider.ts";
import { ViteBuildProvider } from "../providers/ViteBuildProvider.ts";

export class PlatformCommand {
  protected readonly log = $logger();
  protected readonly options = $use(platformOptions);
  protected readonly orchestrator = $inject(PlatformOrchestrator);
  protected readonly inspector = $inject(PlatformInspector);
  protected readonly naming = $inject(NamingService);
  protected readonly boot = $inject(AppEntryProvider);
  protected readonly viteBuild = $inject(ViteBuildProvider);
  protected readonly color = $inject(ConsoleColorProvider);

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
      const apps = await this.resolveApps(root, config);
      const namingCtx = this.naming.forContext(config.project, env);
      const c = this.color;

      // Header
      process.stdout.write(
        `\n\u{1F4E6} ${c.set("WHITE_BOLD", config.project)}\n\n`,
      );

      // Apps
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

      // Environments
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
        process.stdout.write(
          `   ${c.set("GREY_DARK", prefix)} ${c.set("CYAN", envKey.padEnd(10))} ${c.set("GREY_LIGHT", envConfig.adapter)}${domain}\n`,
        );
      }

      // Resources for target env
      const hasDB = apps.some((a) => a.resources.hasDatabase);
      const hasBucket = apps.some((a) => a.resources.hasBucket);

      process.stdout.write(
        `\n   ${c.set("GREY_LIGHT", `Resources for "${env}":`)}\n`,
      );

      // Collect resource lines to determine last item
      const resources: Array<{ label: string; value: string }> = [];

      if (config.isMonorepo) {
        for (const app of apps) {
          resources.push({
            label: "Worker",
            value: namingCtx.worker(app.name),
          });
        }
      } else {
        resources.push({ label: "Worker", value: namingCtx.worker() });
      }

      if (hasDB) {
        resources.push({ label: "D1", value: namingCtx.d1() });
      }

      if (hasBucket) {
        resources.push({ label: "R2", value: namingCtx.r2() });
      }

      for (const [i, res] of resources.entries()) {
        const isLast = i === resources.length - 1;
        const branch = isLast ? "\u2514\u2500\u2500" : "\u251C\u2500\u2500";
        process.stdout.write(
          `   ${c.set("GREY_DARK", branch)} ${c.set("GREY_LIGHT", res.label.padEnd(9))} ${c.set("CYAN", res.value)}\n`,
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
    description: "Build, push, migrate, and activate",
    flags: this.envFlags,
    handler: async ({ flags, root, run }) => {
      process.env.NODE_ENV = "production";

      const config = await this.inspector.resolveConfig(root);
      const env = flags.env ?? config.defaultEnv;
      const apps = await this.resolveApps(root, config);

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
      const apps = await this.resolveApps(root, config);

      await this.orchestrator.down({
        root,
        env: flags.env,
        app: flags.app,
        apps,
        run,
        confirm: (prompt) => ask(prompt),
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
      const apps = await this.resolveApps(root, config);

      const { state } = await this.orchestrator.status({
        root,
        env,
        apps,
        run,
      });

      run.end();

      const c = this.color;

      // Print state
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
        process.stdout.write(`\n   ${c.set("GREY_LIGHT", "Database:")}\n`);
        for (const [i, db] of state.databases.entries()) {
          const isLast = i === state.databases.length - 1;
          const branch = isLast ? "\u2514\u2500\u2500" : "\u251C\u2500\u2500";
          if (db.exists) {
            const id = db.id
              ? ` ${c.set("GREY_LIGHT", db.id.slice(0, 8))}`
              : "";
            process.stdout.write(
              `   ${c.set("GREY_DARK", branch)} ${c.set("CYAN", db.name)}  ${c.set("GREEN", "\u2713")}${id}\n`,
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
      const apps = await this.resolveApps(root, config);
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

  protected readonly push = $command({
    name: "push",
    description: "Upload artifacts to cloud",
    flags: this.envFlags,
    handler: async ({ flags, root, run }) => {
      const config = await this.inspector.resolveConfig(root);
      const env = flags.env ?? config.defaultEnv;
      const envConfig = config.environments[env];
      const adapter = this.orchestrator.resolveAdapter(envConfig.adapter);
      const apps = await this.resolveApps(root, config);
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
        await adapter.push({ ...ctx, app }, run);
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
      const apps = await this.resolveApps(root, config);
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

  protected readonly restart = $command({
    name: "restart",
    description: "Activate latest pushed version",
    flags: this.envFlags,
    handler: async ({ flags, root, run }) => {
      const config = await this.inspector.resolveConfig(root);
      const env = flags.env ?? config.defaultEnv;
      const envConfig = config.environments[env];
      const adapter = this.orchestrator.resolveAdapter(envConfig.adapter);
      const apps = await this.resolveApps(root, config);
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
        await adapter.activate({ ...ctx, app }, run);
      }
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
      this.push,
      this.migrate,
      this.restart,
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
  ): Promise<AppDefinition[]> {
    if (!config.isMonorepo) {
      const entry = await this.boot.getAppEntry(root);
      const appAlepha = await this.viteBuild.init({ entry });
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
      const appAlepha = await this.viteBuild.init({ entry });
      const name = config.appNames.get(appPath) ?? appPath;
      const resources = this.detectResources(appAlepha);

      apps.push({ name, path: appPath, entry, resources });
    }

    return apps;
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
      alepha.inject("CloudflareKVProvider");
      hasKV = true;
    } catch {}

    try {
      alepha.inject("CloudflareQueueProvider");
      hasQueue = true;
    } catch {}

    try {
      const cron = alepha.inject("CronProvider");
      hasCron = cron.getCronJobs().length > 0;
    } catch {}

    return { hasDatabase, hasBucket, hasKV, hasQueue, hasCron };
  }
}
