import { $inject, AlephaError, z } from "alepha";
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
import { ViteUtils } from "../services/ViteUtils.ts";

const drizzleCommandFlags = z.object({
  provider: z
    .text({
      description:
        "Database provider name to target (e.g., 'postgres', 'sqlite')",
    })
    .optional(),
});

export class DbCommand {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly pm = $inject(PackageManagerUtils);
  protected readonly entryProvider = $inject(AppEntryProvider);
  protected readonly viteUtil = $inject(ViteUtils);

  /**
   * Check if database migrations are up to date.
   */
  protected readonly check = $command({
    name: "check",
    mode: true,
    description: "Check if migration files are up to date",
    args: z
      .text({
        title: "path",
        description: "Path to the Alepha server entry file",
      })
      .optional(),
    flags: drizzleCommandFlags,
    handler: async ({ flags, root }) => {
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
      const drifted: Array<{ provider: string; statements: string[] }> = [];

      for (const primitive of repositoryProvider.getRepositories()) {
        const provider = primitive.provider;
        const providerName = provider.name;
        if (accepted.has(providerName)) {
          continue;
        }

        accepted.add(providerName);

        // Honor the --provider filter (previously declared but ignored here).
        if (flags.provider && flags.provider !== providerName) {
          continue;
        }

        const migrationDir = this.fs.join(rootDir, "migrations", providerName);

        const journalBuffer = await this.fs
          .readFile(this.fs.join(migrationDir, "meta", "_journal.json"))
          .catch(() => null);

        // `continue`, not `return`: a journal-less or clean provider must not
        // exit the whole handler and mask drift in the remaining providers
        // (e.g. a clean Postgres hiding a drifted SQLite/D1 migration set).
        if (!journalBuffer) {
          this.log.info(`No migration journal found for '${providerName}'.`);
          continue;
        }

        const journal = JSON.parse(journalBuffer.toString("utf-8"));
        const lastMigration = journal.entries?.[journal.entries.length - 1];
        if (!lastMigration) {
          // A journal exists but records no migrations yet. Reading `.idx` off
          // `undefined` threw a bare TypeError instead of saying so.
          this.log.info(
            `No migrations recorded yet for '${providerName}'; nothing to compare.`,
          );
          continue;
        }
        const snapshotBuffer = await this.fs.readFile(
          this.fs.join(
            migrationDir,
            "meta",
            `${String(lastMigration.idx).padStart(4, "0")}_snapshot.json`,
          ),
        );
        const lastSnapshot = JSON.parse(snapshotBuffer.toString("utf-8"));

        const { statements: migrationStatements } =
          await drizzleKitProvider.generateMigration(provider, lastSnapshot, {
            withoutSchema: true,
          });

        if (migrationStatements.length === 0) {
          this.log.info(`No changes detected for '${providerName}'.`);
          continue;
        }

        drifted.push({
          provider: providerName,
          statements: migrationStatements,
        });
      }

      // Report drift across ALL providers before failing.
      if (drifted.length > 0) {
        for (const { provider: providerName, statements } of drifted) {
          this.log.info("");
          this.log.info(`Detected migration statements for '${providerName}':`);
          this.log.info("");
          for (const stmt of statements) {
            this.log.info(stmt);
          }
          this.log.info("");
          this.log.info(`At least ${statements.length} change(s) detected.`);
        }
        this.log.info("");
        this.log.info(
          "Please, run 'alepha db migrations create' to update the migration files.",
        );
        this.log.info("");

        throw new AlephaError(
          `Database migrations are not up to date (${drifted
            .map((d) => d.provider)
            .join(", ")}).`,
        );
      }
    },
  });

  /**
   * Generate database migration files
   */
  protected readonly create = $command({
    name: "create",
    mode: true,
    description: "Generate migration files from current schema",
    args: z
      .text({
        title: "path",
        description: "Path to the Alepha server entry file",
      })
      .optional(),
    flags: drizzleCommandFlags.extend({
      custom: z
        .boolean()
        .describe(
          "Generate an empty migration file for custom SQL (e.g., for data migrations or manual adjustments)",
        )
        .optional(),
      name: z
        .text({
          description: "Name for the generated migration file",
        })
        .optional(),
    }),
    handler: async ({ args, flags, root }) => {
      const parts: string[] = [];
      if (flags.custom) parts.push(`--custom=1`);
      if (flags.name) parts.push(`--name=${flags.name}`);
      const commandFlags = parts.length > 0 ? parts.join(" ") : undefined;

      await this.runDrizzleKitCommand({
        root,
        args,
        command: "generate",
        commandFlags,
        provider: flags.provider,
        logMessage: (providerName, dialect) =>
          `Generate '${providerName}' migrations (${dialect}) ...`,
      });
    },
  });

  /**
   * Collapse migration history into a single baseline migration.
   */
  protected readonly baselineCreate = $command({
    name: "create",
    mode: true,
    description:
      "Archive existing migrations and generate a single baseline migration from the current schema",
    args: z
      .text({
        title: "path",
        description: "Path to the Alepha server entry file",
      })
      .optional(),
    flags: drizzleCommandFlags,
    handler: async ({ args, flags, root }) => {
      const entry = await this.entryProvider.getAppEntry(root);
      const alepha = await this.utils.loadAlephaFromServerEntryFile({
        mode: "development",
        entry,
      });
      const repositoryProvider =
        alepha.inject<RepositoryProvider>("RepositoryProvider");

      const seen = new Set<string>();
      for (const primitive of repositoryProvider.getRepositories()) {
        const providerName = primitive.provider.name;
        if (providerName === "" || seen.has(providerName)) continue;
        seen.add(providerName);
        if (flags.provider && flags.provider !== providerName) continue;

        const migrationsDir = this.fs.join(root, "migrations", providerName);
        const archived = await this.archiveMigrations(migrationsDir);
        this.log.info(
          `Archived ${archived.length} migration(s) for '${providerName}' into .archive/`,
        );
      }

      await this.runDrizzleKitCommand({
        root,
        args,
        command: "generate",
        commandFlags: "--name=baseline",
        provider: flags.provider,
        logMessage: (providerName, dialect) =>
          `Generate '${providerName}' baseline (${dialect}) ...`,
      });
    },
  });

  /**
   * Push database schema changes directly to the database
   */
  protected readonly push = $command({
    name: "push",
    mode: true,
    description: "Push database schema changes directly to the database",
    args: z
      .text({
        title: "path",
        description: "Path to the Alepha server entry file",
      })
      .optional(),
    flags: drizzleCommandFlags.extend({
      dryRun: z
        .boolean()
        .describe("Preview SQL statements without executing them")
        .optional(),
    }),
    handler: async ({ root, args, flags }) => {
      if (flags.dryRun) {
        const entry = await this.entryProvider.getAppEntry(root);
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

          if (accepted.has(providerName)) continue;
          accepted.add(providerName);

          if (flags.provider && flags.provider !== providerName) continue;

          this.log.info("");
          this.log.info(
            `Dry run for '${providerName}' (${provider.dialect}) ...`,
          );

          await provider.connect?.();

          try {
            const result = await drizzleKitProvider.dryRunPush(provider);

            if (result.statements.length === 0) {
              this.log.info("No changes detected.");
            } else {
              if (result.hasDataLoss) {
                this.log.warn("WARNING: These changes would cause data loss!");
                for (const warning of result.warnings) {
                  this.log.warn(`  ${warning}`);
                }
              }

              this.log.info("");
              this.log.info(
                `${result.statements.length} statement(s) would be executed:`,
              );
              this.log.info("");
              for (const stmt of result.statements) {
                this.log.info(stmt);
              }
            }
          } finally {
            await provider.close?.();
          }
        }
        return;
      }

      await this.runDrizzleKitCommand({
        root,
        args,
        command: "push",
        provider: flags.provider,
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
    mode: true,
    description: "Apply pending migrations to the database",
    args: z
      .text({
        title: "path",
        description: "Path to the Alepha server entry file",
      })
      .optional(),
    flags: drizzleCommandFlags,
    handler: async ({ root, run, mode }) => {
      const entry = await this.entryProvider.getAppEntry(root);

      await run({
        name: `db migrate (${mode || "development"})`,
        handler: async () => {
          process.env.MIGRATE = "true";

          const alepha = await this.viteUtil.runAlepha({
            entry,
            mode: "production",
          });

          await alepha.start();
        },
      });
    },
  });

  /**
   * Launch Drizzle Studio database browser
   */
  protected readonly studio = $command({
    name: "studio",
    mode: true,
    description: "Launch Drizzle Studio database browser",
    args: z
      .text({
        title: "path",
        description: "Path to the Alepha server entry file",
      })
      .optional(),
    flags: drizzleCommandFlags,
    handler: async ({ root, args, flags }) => {
      await this.runDrizzleKitCommand({
        root,
        args,
        command: "studio",
        provider: flags.provider,
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
    children: [this.check, this.create, this.apply],
    handler: async ({ help }) => {
      help();
    },
  });

  /**
   * Parent command for baseline operations.
   */
  protected readonly baseline = $command({
    name: "baseline",
    description:
      "Collapse migration history and record a baseline as already applied",
    children: [this.baselineCreate],
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
    children: [this.migrations, this.baseline, this.push, this.studio],
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
  }): Promise<void> {
    const rootDir = options.root;

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
        command: options.command,
      });

      const migrationsDir = this.fs.join(rootDir, "migrations", providerName);
      const isGenerate = options.command === "generate";

      // Snapshot the directory so the destructive-migration guard below only
      // inspects files THIS run created, not the whole applied history.
      const before = isGenerate
        ? new Set(await this.fs.ls(migrationsDir).catch(() => []))
        : new Set<string>();

      const flags = options.commandFlags ? ` ${options.commandFlags}` : "";
      // drizzle-kit ships embedded in `alepha` — resolve and run it from
      // alepha's own install, so the project never declares it.
      // `global: true` because the command starts with `node` (a system
      // binary) — without it, exec tries to resolve `node` as a
      // node_modules bin and fails.
      const drizzleKit = this.utils.resolveBin("drizzle-kit");
      await this.utils.exec(
        `node "${drizzleKit}" ${options.command} --config="${drizzleConfigJsPath}"${flags}`,
        {
          global: true,
          env: {
            ALEPHA_CLI_IMPORT: "true",
            NODE_OPTIONS: [process.env.NODE_OPTIONS, "--import tsx"]
              .filter(Boolean)
              .join(" "),
          },
        },
      );

      if (!isGenerate) {
        continue;
      }

      // Post-process generated SQL: strip explicit "public". schema qualifiers
      // from FK REFERENCES so migration files stay truly schema-free.
      // search_path handles resolution at runtime.
      if (dialect === "postgresql") {
        await this.stripPublicSchemaFromMigrations(migrationsDir);
      }

      const after = await this.fs.ls(migrationsDir).catch(() => []);
      await this.assertNoDestructiveMigrations(
        migrationsDir,
        after.filter((file) => !before.has(file)),
      );
    }
  }

  /**
   * Remove `"public".` schema qualifiers from FK REFERENCES in SQL migration files.
   *
   * drizzle-kit generates `REFERENCES "public"."table"(...)` even for schema-free
   * models. This breaks when deploying to a non-public schema via search_path.
   */
  protected async stripPublicSchemaFromMigrations(
    migrationsDir: string,
  ): Promise<void> {
    const files = await this.fs.ls(migrationsDir).catch(() => []);

    for (const file of files) {
      if (!file.endsWith(".sql")) continue;

      const filePath = this.fs.join(migrationsDir, file);
      const content = await this.fs.readFile(filePath);
      const sql = content.toString("utf-8");
      const cleaned = sql.replaceAll('"public".', "");

      if (cleaned !== sql) {
        await this.fs.writeFile(filePath, cleaned);
        this.log.debug(`Stripped "public". qualifiers from ${file}`);
      }
    }
  }

  /**
   * Refuse a freshly generated migration that drops a table.
   *
   * Drizzle rebuilds a SQLite table by dropping and recreating it. On
   * Cloudflare D1 that is a data-loss bomb: D1 ignores `PRAGMA
   * foreign_keys=OFF`, so dropping a table that other tables reference with
   * `ON DELETE CASCADE` silently wipes every child row — with no error, on
   * deploy, in production.
   *
   * The generated file is left on disk on purpose: the point is to force a
   * human to read it. If the drop really is intended, keep the file and move
   * on (a re-run detects no schema diff, so nothing is regenerated and this
   * guard stays quiet).
   */
  protected async assertNoDestructiveMigrations(
    migrationsDir: string,
    files: string[],
  ): Promise<void> {
    const offenders: string[] = [];

    for (const file of files) {
      if (!file.endsWith(".sql")) continue;

      const content = await this.fs.readFile(this.fs.join(migrationsDir, file));
      const drops = this.findDropTableStatements(content.toString("utf-8"));

      for (const drop of drops) {
        offenders.push(`  ${file}: ${drop}`);
      }
    }

    if (offenders.length === 0) {
      return;
    }

    throw new AlephaError(
      [
        `Refusing to generate a destructive migration: DROP TABLE found in ${offenders.length} statement(s).`,
        "",
        ...offenders,
        "",
        "On Cloudflare D1, dropping a table that CASCADE children reference wipes those child rows silently.",
        "Review the generated file above. If the drop is intentional, keep it and re-run — nothing will be regenerated.",
        "If it is not, delete the file and adjust your schema (e.g. keep the column, or drop it in a hand-written migration).",
      ].join("\n"),
    );
  }

  /**
   * Extract `DROP TABLE` statements from a SQL migration, skipping any that sit
   * inside a `--` line comment.
   */
  protected findDropTableStatements(sql: string): string[] {
    const statements: string[] = [];

    for (const rawLine of sql.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line.startsWith("--")) continue;

      // Drop the trailing comment so `DROP TABLE x; -- ...` still matches on
      // the statement itself and a commented-out tail can't add a false hit.
      const code = line.split("--")[0];

      if (/\bDROP\s+TABLE\b/i.test(code)) {
        statements.push(code.trim());
      }
    }

    return statements;
  }

  /**
   * Move a provider's migration files and snapshot metadata into `.archive/`.
   *
   * Baselining rewrites history, so the previous files are preserved rather
   * than deleted — they remain the only record of how the schema was reached.
   * Refuses to run twice: a second baseline would overwrite the first archive
   * and lose that record silently.
   */
  protected async archiveMigrations(migrationsDir: string): Promise<string[]> {
    const archiveDir = this.fs.join(migrationsDir, ".archive");

    // `ls().catch(() => null)` rather than `exists()`: a migrations directory
    // that was only ever populated via nested `writeFile` calls (the normal
    // case, both on real disk and in tests) may have no directory entry of
    // its own, so an exact-path `exists()` lookup can miss it. `ls` already
    // has to resolve "does this directory have anything under it" to do its
    // job, so it is the reliable check for both a real project checked out
    // of git and `MemoryFileSystemProvider`.
    const archiveEntries = await this.fs
      .ls(archiveDir, { hidden: true })
      .catch(() => null);
    if (archiveEntries !== null) {
      throw new AlephaError(
        `Archive '${archiveDir}' already exists. This project has been baselined before; remove or rename the archive to baseline again.`,
      );
    }

    const entries = await this.fs.ls(migrationsDir).catch(() => []);

    const sqlFiles = entries
      .map((f) => f.split("/").pop() as string)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    if (sqlFiles.length === 0) {
      return [];
    }

    for (const file of sqlFiles) {
      const content = await this.fs.readFile(this.fs.join(migrationsDir, file));
      await this.fs.writeFile(this.fs.join(archiveDir, file), String(content));
      await this.fs.rm(this.fs.join(migrationsDir, file));
    }

    const metaDir = this.fs.join(migrationsDir, "meta");
    const metaEntries = await this.fs.ls(metaDir).catch(() => []);
    for (const entry of metaEntries) {
      const name = entry.split("/").pop() as string;
      const content = await this.fs.readFile(this.fs.join(metaDir, name));
      await this.fs.writeFile(
        this.fs.join(archiveDir, "meta", name),
        String(content),
      );
      await this.fs.rm(this.fs.join(metaDir, name));
    }

    return sqlFiles;
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
    command?: string;
  }): Promise<string> {
    // For migration generation, use schema-free models so the SQL output
    // doesn't contain hardcoded schema qualifiers (e.g. "myschema"."users").
    // The schema is applied at runtime via search_path.
    const withoutSchema = options.command === "generate";
    const models = withoutSchema
      ? Object.keys(options.kit.getModelsWithoutSchema(options.provider))
      : Object.keys(options.kit.getModels(options.provider));
    const entitiesJs = this.generateEntitiesJs(
      options.entry,
      options.providerName,
      models,
      withoutSchema,
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

    // Use schema-specific migration table so multiple schemas sharing
    // the same database each track their own migration history.
    if (options.dialect === "postgresql") {
      config.migrations = {
        table: options.provider.migrationsTable,
      };
    }

    // Schema filter is only needed for push/studio (introspection).
    // For generate, models are already schema-free.
    if (options.provider.schema && !withoutSchema) {
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
        // For D1, we need to fill D1 bindings in a way that drizzle-kit can use it, since D1 doesn't use a traditional connection URL
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

  // ===========================================
  // Drizzle ORM & Kit Utilities
  // ===========================================

  /**
   * Generate JavaScript code for Drizzle entities export.
   *
   * When `withoutSchema` is true, uses `getModelsWithoutSchema()` to produce
   * schema-free models for migration generation.
   */
  public generateEntitiesJs(
    entry: string,
    provider: string,
    models: string[] = [],
    withoutSchema = false,
  ): string {
    const getModelsCall = withoutSchema
      ? "kit.getModelsWithoutSchema(provider)"
      : "kit.getModels(provider)";

    return `
import "${entry}";
import { DrizzleKitProvider, Repository } from "alepha/orm";

const alepha = globalThis.__alepha;
const kit = alepha.inject(DrizzleKitProvider);
const provider = alepha.services(Repository).find((it) => it.provider.name === "${provider}").provider;
const models = ${getModelsCall};

${models.map((it: string) => `export const ${it} = models["${it}"];`).join("\n")}

`.trim();
  }
}
