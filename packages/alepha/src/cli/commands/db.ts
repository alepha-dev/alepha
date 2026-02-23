import { $inject, AlephaError, t } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import type {
  DatabaseProvider,
  DrizzleKitProvider,
  RepositoryProvider,
} from "alepha/orm";
import { FileSystemProvider } from "alepha/system";
import { AppEntryProvider } from "../providers/AppEntryProvider.ts";
import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";
import { PackageManagerUtils } from "../services/PackageManagerUtils.ts";

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
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly pm = $inject(PackageManagerUtils);
  protected readonly entryProvider = $inject(AppEntryProvider);

  /**
   * Check if database migrations are up to date.
   */
  protected readonly check = $command({
    name: "check",
    description: "Check if migration files are up to date",
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

      const entry = await this.entryProvider.getAppEntry(root);
      const alepha = await this.utils.loadAlephaFromServerEntryFile({
        mode: "development",
        entry,
      });

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

        const migrationDir = this.fs.join(rootDir, "migrations", providerName);

        const journalBuffer = await this.fs
          .readFile(this.fs.join(migrationDir, "meta", "_journal.json"))
          .catch(() => null);

        if (!journalBuffer) {
          this.log.info("No migration journal found.");
          return;
        }

        const journal = JSON.parse(journalBuffer.toString("utf-8"));
        const lastMigration = journal.entries[journal.entries.length - 1];
        const snapshotBuffer = await this.fs.readFile(
          this.fs.join(
            migrationDir,
            "meta",
            `${String(lastMigration.idx).padStart(4, "0")}_snapshot.json`,
          ),
        );
        const lastSnapshot = JSON.parse(snapshotBuffer.toString("utf-8"));

        const { statements: migrationStatements } =
          await drizzleKitProvider.generateMigration(provider, lastSnapshot);

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
          "Please, run 'alepha db migrations generate' to update the migration files.",
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
    description: "Generate migration files from current schema",
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
      name: t.optional(
        t.text({
          description: "Name for the generated migration file",
        }),
      ),
    }),
    handler: async ({ args, flags, root }) => {
      const parts: string[] = [];
      if (flags.custom) parts.push(`--custom=${flags.custom}`);
      if (flags.name) parts.push(`--name=${flags.name}`);
      const commandFlags = parts.length > 0 ? parts.join(" ") : undefined;

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
  protected readonly apply = $command({
    name: "apply",
    description: "Apply pending migrations to the database",
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
   * Parent command for migration operations.
   */
  protected readonly migrations = $command({
    name: "migrations",
    aliases: ["m"],
    description: "Manage database migrations",
    children: [this.check, this.generate, this.apply],
    handler: async ({ help }) => {
      help();
    },
  });

  /**
   * Parent command for database operations.
   */
  public readonly db = $command({
    name: "db",
    description: "Database management commands",
    children: [this.migrations, this.push, this.studio],
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

    const entry = await this.entryProvider.getAppEntry(rootDir);
    const alepha = await this.utils.loadAlephaFromServerEntryFile({
      mode: "development",
      entry,
    });

    const drizzleKitProvider =
      alepha.inject<DrizzleKitProvider>("DrizzleKitProvider");
    const repositoryProvider =
      alepha.inject<RepositoryProvider>("RepositoryProvider");
    const accepted = new Set<string>([]);

    for (const primitive of repositoryProvider.getRepositories()) {
      const provider = primitive.provider;
      const providerName = provider.name;
      const dialect = provider.dialect;

      if (providerName === "") {
        continue;
      }

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
        providerDriver: provider.driver,
        dialect,
        entry: this.fs.join(rootDir, entry.server),
        rootDir,
      });

      const flags = options.commandFlags ? ` ${options.commandFlags}` : "";
      await this.utils.exec(
        `drizzle-kit ${options.command} --config=${drizzleConfigJsPath}${flags}`,
        {
          env: {
            NODE_OPTIONS: [process.env.NODE_OPTIONS, "--import tsx"]
              .filter(Boolean)
              .join(" "),
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
    providerDriver: string;
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

    if (options.providerDriver === "d1") {
      config.driver = "d1-http";
    }

    if (options.providerDriver === "pglite") {
      config.driver = "pglite";
    }

    if (options.dialect === "sqlite") {
      if (options.providerDriver === "d1") {
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
        if (!url.startsWith("d1://")) {
          throw new AlephaError("D1 provider URL must start with 'd1://'.");
        }

        const [, databaseId] = url
          .replace("d1://", "")
          .replace("d1:", "")
          .split(":");

        if (!databaseId) {
          throw new AlephaError(
            "Database ID is missing in the D1 provider URL. Cloudflare D1 URL format: d1://<database_name>:<database_id>",
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
        url = this.fs.join(options.rootDir, url);

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
