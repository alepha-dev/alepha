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

      // An app with no ORM has nothing to check, and saying so beats the
      // `Service not found: RepositoryProvider` stack trace this used to
      // throw. It also lets `alepha verify` run the check unconditionally:
      // gating it on a `migrations/` directory existing meant the one state
      // worth catching — entities declared, no migrations generated yet —
      // was the exact state that skipped the check.
      //
      // Resolved by name, so absence can only be observed by trying. Anything
      // that is not "this app has no ORM" is rethrown.
      let repositoryProvider: RepositoryProvider;
      try {
        repositoryProvider =
          alepha.inject<RepositoryProvider>("RepositoryProvider");
      } catch (err) {
        if (!/Service not found/i.test((err as Error)?.message ?? "")) {
          throw err;
        }
        this.log.info("No database configured; nothing to check.");
        return;
      }
      const drizzleKitProvider =
        alepha.inject<DrizzleKitProvider>("DrizzleKitProvider");
      const accepted = new Set<string>([]);
      const drifted: Array<{
        provider: string;
        statements: string[];
        layout: "v1" | "legacy" | "none";
      }> = [];

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
        const lastSnapshot = await this.resolveLastSnapshot(migrationDir);

        // No snapshot is not "nothing to compare" — it is a comparison
        // against an empty database, and `generateMigration` already does
        // exactly that when `prevSnapshot` is undefined. Skipping it here
        // meant a project with entities and zero migrations reported clean
        // and exited 0, so `alepha verify` passed on an app whose first
        // authenticated request would 500 with `DbTableNotFoundError`. An app
        // with no models still produces no statements, so a genuinely empty
        // provider stays green on the same code path.
        if (!lastSnapshot) {
          this.log.info(
            `No migrations recorded yet for '${providerName}'; comparing against an empty database.`,
          );
        }

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
          layout: await this.migrationsLayout(migrationDir),
        });
      }

      // Report drift across ALL providers before failing.
      if (drifted.length > 0) {
        for (const { provider: providerName, statements, layout } of drifted) {
          this.log.info("");
          this.log.info(`Detected migration statements for '${providerName}':`);
          this.log.info("");
          for (const stmt of statements) {
            this.log.info(stmt);
          }
          this.log.info("");
          this.log.info(`At least ${statements.length} change(s) detected.`);
          if (layout === "legacy") {
            this.explainLegacyLayout(providerName);
          }
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
      hints: z
        .text({
          description:
            "JSON array of drizzle-kit hints resolving ambiguous diffs (e.g. rename-vs-create). drizzle-kit exits with code 2 and prints the exact JSON to pass when a hint is required.",
          // `z.text()` caps at 255 characters by default, which is roughly two
          // hints — and drizzle-kit demands every ambiguity be resolved in a
          // single invocation, so a rewrite of one entity family already blows
          // past it. The flag carries a JSON document, not a label.
          size: "rich",
        })
        .optional(),
    }),
    handler: async ({ args, flags, root }) => {
      const parts: string[] = [];
      if (flags.custom) parts.push(`--custom=1`);
      if (flags.name) parts.push(`--name=${flags.name}`);
      if (flags.hints) {
        // The hints value is a JSON array (double quotes only) — wrap it in
        // single quotes so it survives the shell as one argument.
        parts.push(`--hints='${flags.hints}'`);
      }
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
   * Record the baseline migration as applied, without executing it.
   */
  protected readonly baselineMark = $command({
    name: "mark",
    mode: true,
    description:
      "Record the baseline migration as already applied, without executing it",
    args: z
      .text({
        title: "path",
        description: "Path to the Alepha server entry file",
      })
      .optional(),
    flags: drizzleCommandFlags,
    handler: async ({ flags, root }) => {
      const entry = await this.entryProvider.getAppEntry(root);
      const alepha = await this.utils.loadAlephaFromServerEntryFile({
        mode: "production",
        entry,
      });
      const repositoryProvider =
        alepha.inject<RepositoryProvider>("RepositoryProvider");

      const seen = new Set<string>();
      for (const primitive of repositoryProvider.getRepositories()) {
        const provider = primitive.provider;
        const providerName = provider.name;
        if (providerName === "" || seen.has(providerName)) continue;
        seen.add(providerName);
        if (flags.provider && flags.provider !== providerName) continue;

        // Cloudflare D1 doesn't go through drizzle's migrator at all — its
        // deploy path keys off a filename-based bookkeeping table driven by
        // wrangler (see WranglerApi.d1MigrationsBaseline), which needs the
        // project/env/tenant naming that only the `platform` command tree
        // can resolve. Redirect here rather than let `markBaselineApplied`
        // fall through to `runMigrator`'s generic "driver not supported"
        // error, which would wrongly suggest the capability doesn't exist.
        if (provider.driver === "d1") {
          throw new AlephaError(
            `'alepha db baseline mark' does not support Cloudflare D1 — use 'alepha platform db baseline mark' instead, which drives the wrangler bookkeeping table directly.`,
          );
        }

        const migrationsFolder = this.fs.join(root, "migrations", providerName);

        // `loadAlephaFromServerEntryFile` never calls `alepha.start()` (it
        // sets `ALEPHA_CLI_IMPORT`, which short-circuits `run(alepha)`
        // before the lifecycle starts), so no provider's `start` hook has
        // opened a connection yet. Open and close it explicitly here,
        // mirroring `push --dry-run` below.
        await provider.connect?.();
        try {
          await provider.markBaselineApplied(migrationsFolder);
        } finally {
          await provider.close?.();
        }
      }
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
    children: [this.baselineCreate, this.baselineMark],
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
   * Resolve a migrations-directory entry to the actual `.sql` file it
   * represents, across both drizzle-kit layouts:
   *
   * - pre-v1: the entry itself IS the SQL file (`<name>.sql`).
   * - v1: the entry is a folder holding `migration.sql`
   *   (`<tag>/migration.sql`) — drizzle-kit v1 never produces a flat file.
   *
   * Returns `null` for anything that isn't a migration under either layout
   * (e.g. `meta/`, `.archive/`), so callers can skip it without guessing.
   *
   * Shared by `assertNoDestructiveMigrations` and
   * `stripPublicSchemaFromMigrations` — both used to filter on
   * `.endsWith(".sql")` alone, which matched nothing once `generate`
   * started producing v1's folder layout: the destructive-migration guard
   * (the only automated defence against the D1 cascade-wipe bomb) ran
   * clean on every v1 migration regardless of content, and the Postgres
   * `"public".` qualifier strip silently stopped running at all.
   */
  protected async resolveMigrationSqlPath(
    migrationsDir: string,
    entry: string,
  ): Promise<string | null> {
    if (entry.endsWith(".sql")) {
      return this.fs.join(migrationsDir, entry);
    }

    const nestedSqlPath = this.fs.join(migrationsDir, entry, "migration.sql");
    return (await this.fs.exists(nestedSqlPath)) ? nestedSqlPath : null;
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
    const entries = await this.fs.ls(migrationsDir).catch(() => []);

    for (const entry of entries) {
      const sqlPath = await this.resolveMigrationSqlPath(migrationsDir, entry);
      if (!sqlPath) continue;

      const content = await this.fs.readFile(sqlPath);
      const sql = content.toString("utf-8");
      const cleaned = sql.replaceAll('"public".', "");

      if (cleaned !== sql) {
        await this.fs.writeFile(sqlPath, cleaned);
        this.log.debug(`Stripped "public". qualifiers from ${entry}`);
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
      const sqlPath = await this.resolveMigrationSqlPath(migrationsDir, file);
      if (!sqlPath) continue;

      const content = await this.fs.readFile(sqlPath);
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

    // drizzle-kit v1: one folder per migration, `<tag>/migration.sql`, no
    // flat `.sql` file anywhere. From this branch on, every project this
    // command touches is v1-native — a flat-only archive silently no-ops on
    // a first baseline (`sqlFiles.length === 0` returns `[]` without ever
    // creating `.archive/`), and `generate --name=baseline` then runs
    // against the still-present v1 history, producing an INCREMENTAL
    // migration mislabeled "baseline" instead of a true one.
    const v1Folders: string[] = [];
    for (const raw of entries) {
      const name = raw.split("/").pop() as string;
      if (name === "meta" || name.endsWith(".sql")) continue;
      const hasMigrationSql = await this.fs.exists(
        this.fs.join(migrationsDir, name, "migration.sql"),
      );
      if (hasMigrationSql) {
        v1Folders.push(name);
      }
    }
    v1Folders.sort();

    if (sqlFiles.length === 0 && v1Folders.length === 0) {
      return [];
    }

    // `writeFile` on a real filesystem does not create missing parent
    // directories (unlike the in-memory test double), so `.archive/` and
    // `.archive/meta/` must be created explicitly before the first write.
    await this.fs.mkdir(archiveDir, { recursive: true }).catch(() => null);

    for (const file of sqlFiles) {
      const content = await this.fs.readFile(this.fs.join(migrationsDir, file));
      await this.fs.writeFile(this.fs.join(archiveDir, file), String(content));
      await this.fs.rm(this.fs.join(migrationsDir, file));
    }

    const metaDir = this.fs.join(migrationsDir, "meta");
    const metaEntries = await this.fs.ls(metaDir).catch(() => []);
    if (metaEntries.length > 0) {
      await this.fs
        .mkdir(this.fs.join(archiveDir, "meta"), { recursive: true })
        .catch(() => null);
    }
    for (const entry of metaEntries) {
      const name = entry.split("/").pop() as string;
      const content = await this.fs.readFile(this.fs.join(metaDir, name));
      await this.fs.writeFile(
        this.fs.join(archiveDir, "meta", name),
        String(content),
      );
      await this.fs.rm(this.fs.join(metaDir, name));
    }

    // Move each v1 folder's files (migration.sql, snapshot.json, ...) one
    // file at a time, mirroring the flat-`.sql`/`meta` archiving above,
    // rather than a directory-level `mv`. `MemoryFileSystemProvider` only
    // tracks directories that were explicitly `mkdir`'d — every migration
    // folder in these tests (and every one `writeFile` alone can produce)
    // is registered purely through its nested file paths, so a directory
    // `mv` would find nothing to move.
    for (const tag of v1Folders) {
      const folderDir = this.fs.join(migrationsDir, tag);
      const archiveFolderDir = this.fs.join(archiveDir, tag);
      const folderEntries = await this.fs.ls(folderDir).catch(() => []);

      await this.fs
        .mkdir(archiveFolderDir, { recursive: true })
        .catch(() => null);

      for (const entry of folderEntries) {
        const name = entry.split("/").pop() as string;
        const content = await this.fs.readFile(this.fs.join(folderDir, name));
        await this.fs.writeFile(
          this.fs.join(archiveFolderDir, name),
          String(content),
        );
        await this.fs.rm(this.fs.join(folderDir, name));
      }

      await this.fs
        .rm(folderDir, { recursive: true, force: true })
        .catch(() => null);
    }

    return [...sqlFiles, ...v1Folders];
  }

  /**
   * Locate the most recently recorded schema snapshot for a migrations
   * directory, across both layouts drizzle-kit has used:
   *
   * - pre-v1 (`meta/_journal.json` + `meta/<idx>_snapshot.json`): the format
   *   every migration in this repo was generated in before the v1 upgrade.
   * - v1 (one `<tag>/` folder per migration, each with its own
   *   `snapshot.json`, no journal at all): what `drizzle-kit generate`
   *   produces now. `drizzle-orm@1`'s own `readMigrationFiles` refuses to
   *   even look at the old layout — it throws telling the caller to run
   *   `drizzle-kit up` — so once a project's migrations are in the new
   *   layout, this method must be too, or `check` silently stops comparing
   *   anything.
   *
   * v1 folders are checked FIRST, journal second — not the other way
   * around. A project mid-upgrade (pre-v1 history on disk, then `alepha db
   * migrations create` run under v1) has both: a frozen `meta/_journal.json`
   * that v1's `generate` never touches again, and a v1 folder that is
   * unconditionally newer than anything the journal could describe the
   * moment it exists. Treating the journal as authoritative whenever it's
   * present — the previous behavior — would compare against the stale
   * pre-v1 snapshot even after a v1 migration made it obsolete, reporting
   * drift a migration already covers and risking a duplicate on `create`.
   * The journal is therefore only consulted when there are no v1 folders
   * at all, i.e. the project hasn't been touched by v1 yet.
   *
   * Returns `null` when nothing is recorded yet, so callers can tell that
   * apart from "found a snapshot" without inspecting shape.
   */
  /**
   * Which on-disk layout a migrations folder uses.
   *
   * - `"v1"` — one directory per migration, each with its own `snapshot.json`.
   * - `"legacy"` — the pre-v1 shape: flat `NNNN_name.sql` plus a `meta/`
   *   directory holding `_journal.json` and numbered snapshots.
   * - `"none"` — nothing recorded yet.
   *
   * Worth distinguishing because drizzle v1 reads a legacy snapshot fine but
   * *emits* constraints differently from the version that wrote it — named
   * foreign keys, inline `UNIQUE`, no `NOT NULL` on an integer primary key. So
   * it derives a diff for tables nobody touched, and `check` reports drift that
   * looks exactly like a schema change. See {@link explainLegacyLayout}.
   */
  protected async migrationsLayout(
    migrationDir: string,
  ): Promise<"v1" | "legacy" | "none"> {
    const entries = await this.fs.ls(migrationDir).catch(() => []);
    for (const entry of entries) {
      const name = entry.split("/").pop() as string;
      if (name === "meta" || name === ".archive") continue;
      if (
        await this.fs.exists(this.fs.join(migrationDir, name, "snapshot.json"))
      ) {
        return "v1";
      }
    }
    const hasJournal = await this.fs.exists(
      this.fs.join(migrationDir, "meta", "_journal.json"),
    );
    return hasJournal ? "legacy" : "none";
  }

  /**
   * Say why a legacy folder is probably not the drift it looks like.
   *
   * Without this the operator sees a full table rebuild — `DROP TABLE` and
   * all — for entities they never edited, which on Cloudflare D1 is exactly
   * the shape that has already cost one production database.
   */
  protected explainLegacyLayout(providerName: string): void {
    this.log.info("");
    this.log.info(
      `The '${providerName}' migrations folder is in the pre-v1 layout (meta/_journal.json).`,
    );
    this.log.info(
      "Drizzle v1 emits constraints differently from the version that wrote those",
    );
    this.log.info(
      "snapshots, so some — possibly all — of the statements above are a change of",
    );
    this.log.info(
      "representation, not of schema. Compare them column by column before applying:",
    );
    this.log.info(
      "a rebuild goes through DROP TABLE, which on D1 cascades to child rows.",
    );
    this.log.info("");
    this.log.info("To resolve, upgrade the folder and collapse the history:");
    this.log.info("  npx drizzle-kit up --config=<generated config>");
    this.log.info("  alepha db baseline create");
    this.log.info("  alepha platform db baseline mark --env <env> --reset");
    this.log.info("");
  }

  protected async resolveLastSnapshot(
    migrationDir: string,
  ): Promise<any | null> {
    // v1 layout: folder names are timestamp-prefixed (YYYYMMDDHHMMSS_name),
    // so a plain string sort orders them chronologically — the same
    // assumption drizzle-kit's own folder scan relies on.
    const entries = await this.fs.ls(migrationDir).catch(() => []);
    const folders: string[] = [];
    for (const entry of entries) {
      const name = entry.split("/").pop() as string;
      if (name === "meta" || name === ".archive") continue;
      const hasSnapshot = await this.fs.exists(
        this.fs.join(migrationDir, name, "snapshot.json"),
      );
      if (hasSnapshot) {
        folders.push(name);
      }
    }

    if (folders.length > 0) {
      folders.sort();
      const lastFolder = folders[folders.length - 1];
      const snapshotBuffer = await this.fs.readFile(
        this.fs.join(migrationDir, lastFolder, "snapshot.json"),
      );
      return JSON.parse(snapshotBuffer.toString("utf-8"));
    }

    // Pre-v1 layout, and only reached when no v1 folder exists.
    const journalBuffer = await this.fs
      .readFile(this.fs.join(migrationDir, "meta", "_journal.json"))
      .catch(() => null);

    if (!journalBuffer) {
      return null;
    }

    const journal = JSON.parse(journalBuffer.toString("utf-8"));
    const lastMigration = journal.entries?.[journal.entries.length - 1];
    if (!lastMigration) {
      return null;
    }
    const snapshotBuffer = await this.fs.readFile(
      this.fs.join(
        migrationDir,
        "meta",
        `${String(lastMigration.idx).padStart(4, "0")}_snapshot.json`,
      ),
    );
    return JSON.parse(snapshotBuffer.toString("utf-8"));
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
      // drizzle-kit treats `schema` as a glob, and a backslash is an escape
      // character there rather than a separator. On Windows the path is
      // perfectly valid and the file is right where it says — the glob simply
      // matches nothing, so the generated migration comes out empty.
      schema: entitiesJsPath.replaceAll("\\", "/"),
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

    // Interpolated as JSON, not into bare quotes: `entry` is a filesystem path
    // and `provider` a name, and either containing a quote or a backslash —
    // every Windows path contains backslashes — produces a module that does not
    // parse, or worse, one that parses as something else.
    const entrySpecifier = JSON.stringify(entry);
    const providerName = JSON.stringify(provider);

    return `
import ${entrySpecifier};
import { DrizzleKitProvider, Repository } from "alepha/orm";

const alepha = globalThis.__alepha;
const kit = alepha.inject(DrizzleKitProvider);
const provider = alepha.services(Repository).find((it) => it.provider.name === ${providerName}).provider;
const models = ${getModelsCall};

${models.map((it: string) => `export const ${it} = models["${it}"];`).join("\n")}

`.trim();
  }
}
