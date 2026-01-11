import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { $inject, AlephaError, t } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import type {
  DatabaseProvider,
  DrizzleKitProvider,
  RepositoryProvider,
} from "alepha/orm";
import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";

const drizzleCommandFlags = t.object({
  provider: t.optional(
    t.text({
      description:
        "Database provider name to target (e.g., 'postgres', 'sqlite')",
    }),
  ),
  mode: t.optional(
    t.text({
      description:
        "Environment variable file(s) to load (e.g., 'production' to load .env.production) https://vite.dev/guide/env-and-mode",
    }),
  ),
});

export class DbCommand {
  protected readonly log = $logger();
  protected readonly utils = $inject(AlephaCliUtils);

  /**
   * Check if database migrations are up to date.
   */
  protected readonly check = $command({
    name: "check-migrations",
    description: "Check if database migration files are up to date",
    args: t.optional(
      t.text({
        title: "path",
        description: "Path to the Alepha server entry file",
      }),
    ),
    flags: drizzleCommandFlags,
    handler: async ({ args, root }) => {
      const rootDir = root;
      this.log.debug(`Using project root: ${rootDir}`);

      const { alepha } = await this.utils.loadAlephaFromServerEntryFile(
        rootDir,
        args,
      );

      const repositoryProvider =
        alepha.inject<RepositoryProvider>("RepositoryProvider");
      const drizzleKitProvider =
        alepha.inject<DrizzleKitProvider>("DrizzleKitProvider");
      const accepted = new Set<string>([]);

      for (const primitive of repositoryProvider.getRepositories()) {
        const provider = primitive.provider;
        const providerName = provider.name;
        if (accepted.has(providerName)) {
          continue;
        }

        accepted.add(providerName);

        const migrationDir = join(rootDir, "migrations", providerName);

        const journalFile = await readFile(
          `${migrationDir}/meta/_journal.json`,
          "utf-8",
        ).catch(() => null);

        if (!journalFile) {
          this.log.info("No migration journal found.");
          return;
        }

        const journal = JSON.parse(journalFile);
        const lastMigration = journal.entries[journal.entries.length - 1];
        const lastSnapshot = JSON.parse(
          await readFile(
            `${migrationDir}/meta/${String(lastMigration.idx).padStart(4, "0")}_snapshot.json`,
            "utf-8",
          ),
        );

        const models = drizzleKitProvider.getModels(provider);
        const kit = drizzleKitProvider.importDrizzleKit();
        const now = kit.generateDrizzleJson(models, lastSnapshot.id);

        const migrationStatements = await new Promise<Array<any>>((resolve) => {
          (async () => {
            const timer = setTimeout(() => {
              resolve([{ message: "Migration generation timed out." }]);
            }, 5000);
            const statements = await kit.generateMigration(lastSnapshot, now);
            clearTimeout(timer);
            resolve(statements);
          })();
        });

        if (migrationStatements.length === 0) {
          this.log.info("No changes detected.");
          return;
        }

        this.log.info("");
        this.log.info("Detected migration statements:");
        this.log.info("");
        for (const stmt of migrationStatements) {
          this.log.info(stmt);
        }
        this.log.info("");

        this.log.info(
          `At least ${migrationStatements.length} change(s) detected.`,
        );
        this.log.info(
          "Please, run 'alepha db:generate' to update the migration files.",
        );
        this.log.info("");

        throw new AlephaError("Database migrations are not up to date.");
      }
    },
  });

  /**
   * Generate database migration files
   */
  protected readonly generate = $command({
    name: "generate",
    description: "Generate migration files based on current database schema",
    args: t.optional(
      t.text({
        title: "path",
        description: "Path to the Alepha server entry file",
      }),
    ),
    flags: t.extend(drizzleCommandFlags, {
      custom: t.optional(
        t.text({
          description:
            "Custom migration name for drizzle-kit generate --custom",
        }),
      ),
    }),
    handler: async ({ args, flags, root }) => {
      const commandFlags = flags.custom
        ? `--custom=${flags.custom}`
        : undefined;

      await this.runDrizzleKitCommand({
        root,
        args,
        command: "generate",
        commandFlags,
        provider: flags.provider,
        env: flags.mode,
        logMessage: (providerName, dialect) =>
          `Generate '${providerName}' migrations (${dialect}) ...`,
      });
    },
  });

  /**
   * Push database schema changes directly to the database
   */
  protected readonly push = $command({
    name: "push",
    description: "Push database schema changes directly to the database",
    args: t.optional(
      t.text({
        title: "path",
        description: "Path to the Alepha server entry file",
      }),
    ),
    flags: drizzleCommandFlags,
    handler: async ({ root, args, flags }) => {
      await this.runDrizzleKitCommand({
        root,
        args,
        command: "push",
        provider: flags.provider,
        env: flags.mode,
        logMessage: (providerName, dialect) =>
          `Push '${providerName}' schema (${dialect}) ...`,
      });
    },
  });

  /**
   * Apply pending database migrations
   */
  protected readonly migrate = $command({
    name: "migrate",
    description: "Apply pending database migrations",
    args: t.optional(
      t.text({
        title: "path",
        description: "Path to the Alepha server entry file",
      }),
    ),
    flags: drizzleCommandFlags,
    handler: async ({ root, args, flags }) => {
      await this.runDrizzleKitCommand({
        root,
        args,
        command: "migrate",
        provider: flags.provider,
        env: flags.mode,
        logMessage: (providerName, dialect) =>
          `Migrate '${providerName}' database (${dialect}) ...`,
      });
    },
  });

  /**
   * Launch Drizzle Studio database browser
   */
  protected readonly studio = $command({
    name: "studio",
    description: "Launch Drizzle Studio database browser",
    args: t.optional(
      t.text({
        title: "path",
        description: "Path to the Alepha server entry file",
      }),
    ),
    flags: drizzleCommandFlags,
    handler: async ({ root, args, flags }) => {
      await this.runDrizzleKitCommand({
        root,
        args,
        command: "studio",
        provider: flags.provider,
        env: flags.mode,
        logMessage: (providerName, dialect) =>
          `Launch Studio for '${providerName}' (${dialect}) ...`,
      });
    },
  });

  /**
   * Parent command for database operations.
   */
  public readonly db = $command({
    name: "db",
    description: "Database management commands",
    children: [this.check, this.generate, this.push, this.migrate, this.studio],
    handler: async ({ help }) => {
      help();
    },
  });

  /**
   * Run a drizzle-kit command for all database providers in an Alepha instance.
   */
  public async runDrizzleKitCommand(options: {
    root: string;
    args?: string;
    command: string;
    commandFlags?: string;
    provider?: string;
    logMessage: (providerName: string, dialect: string) => string;
    env?: string;
  }): Promise<void> {
    const rootDir = options.root;

    const envFiles = [".env"];
    if (options.env) {
      envFiles.push(`.env.${options.env}`);
    }

    await this.utils.loadEnv(rootDir, envFiles);

    this.log.debug(`Using project root: ${rootDir}`);

    const { alepha, entry } = await this.utils.loadAlephaFromServerEntryFile(
      rootDir,
      options.args,
    );

    const drizzleKitProvider =
      alepha.inject<DrizzleKitProvider>("DrizzleKitProvider");
    const repositoryProvider =
      alepha.inject<RepositoryProvider>("RepositoryProvider");
    const accepted = new Set<string>([]);

    for (const primitive of repositoryProvider.getRepositories()) {
      const provider = primitive.provider;
      const providerName = provider.name;
      const dialect = provider.dialect;

      if (accepted.has(providerName)) {
        continue;
      }
      accepted.add(providerName);

      // Skip if provider filter is set and doesn't match
      if (options.provider && options.provider !== providerName) {
        this.log.debug(
          `Skipping provider '${providerName}' (filter: ${options.provider})`,
        );
        continue;
      }

      this.log.info("");
      this.log.info(options.logMessage(providerName, dialect));

      const drizzleConfigJsPath = await this.prepareDrizzleConfig({
        kit: drizzleKitProvider,
        provider,
        providerName,
        providerUrl: provider.url,
        dialect,
        entry,
        rootDir,
      });

      const flags = options.commandFlags ? ` ${options.commandFlags}` : "";
      await this.utils.exec(
        `drizzle-kit ${options.command} --config=${drizzleConfigJsPath}${flags}`,
        {
          env: {
            NODE_OPTIONS: "--import tsx",
          },
        },
      );
    }
  }

  /**
   * Prepare Drizzle configuration files for a database provider.
   */
  public async prepareDrizzleConfig(options: {
    kit: any;
    provider: DatabaseProvider;
    providerName: string;
    providerUrl: string;
    dialect: string;
    entry: string;
    rootDir: string;
  }): Promise<string> {
    const models = Object.keys(options.kit.getModels(options.provider));
    const entitiesJs = this.utils.generateEntitiesJs(
      options.entry,
      options.providerName,
      models,
    );

    const entitiesJsPath = await this.utils.writeConfigFile(
      "entities.js",
      entitiesJs,
      options.rootDir,
    );

    const config: Record<string, any> = {
      schema: entitiesJsPath,
      out: `./migrations/${options.providerName}`,
      dialect: options.dialect,
      dbCredentials: {
        url: options.providerUrl,
      },
    };

    if (options.provider.schema) {
      config.schemaFilter = options.provider.schema;
    }

    if (options.providerName === "d1") {
      config.driver = "d1-http";
    }

    if (options.providerName === "pglite") {
      config.driver = "pglite";
    }

    if (options.dialect === "sqlite") {
      if (options.providerName === "d1") {
        const token = process.env.CLOUDFLARE_API_TOKEN;
        if (!token) {
          throw new AlephaError(
            "CLOUDFLARE_API_TOKEN environment variable is not set. https://orm.drizzle.team/docs/guides/d1-http-with-drizzle-kit",
          );
        }

        const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
        if (!accountId) {
          throw new AlephaError(
            "CLOUDFLARE_ACCOUNT_ID environment variable is not set. https://orm.drizzle.team/docs/guides/d1-http-with-drizzle-kit",
          );
        }

        const url = options.providerUrl;
        if (!url.startsWith("cloudflare-d1://")) {
          throw new AlephaError(
            "D1 provider URL must start with 'cloudflare-d1://'.",
          );
        }

        const [, databaseId] = url
          .replace("cloudflare-d1://", "")
          .replace("cloudflare-d1:", "")
          .split(":");

        if (!databaseId) {
          throw new AlephaError(
            "Database ID is missing in the D1 provider URL. Cloudflare D1 URL format: cloudflare-d1://<database_name>:<database_id>",
          );
        }

        config.dbCredentials = {
          accountId,
          databaseId,
          token,
        };
      } else {
        let url = options.providerUrl;
        url = url.replace("sqlite://", "").replace("file://", "");
        url = join(options.rootDir, url);

        config.dbCredentials = {
          url,
        };
      }
    }

    const drizzleConfigJs = `export default ${JSON.stringify(config, null, 2)}`;

    return await this.utils.writeConfigFile(
      "drizzle.config.js",
      drizzleConfigJs,
      options.rootDir,
    );
  }
}
