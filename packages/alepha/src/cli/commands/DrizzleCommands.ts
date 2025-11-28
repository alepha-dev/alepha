import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { $inject, AlephaError, t } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import { ProcessRunner } from "../services/ProcessRunner.ts";
import { ProjectUtils } from "../services/ProjectUtils.ts";

const drizzleCommandFlags = t.object({
  provider: t.optional(
    t.text({
      description:
        "Database provider name to target (e.g., 'postgres', 'sqlite')",
    }),
  ),
});

export class DrizzleCommands {
  log = $logger();
  runner = $inject(ProcessRunner);
  utils = $inject(ProjectUtils);

  /**
   * Check if database migrations are up to date
   *
   * - Loads the Alepha instance from the specified entry file.
   * - Retrieves all repository descriptors to gather database models.
   * - Reads the last migration snapshot from the migration journal.
   * - Generates the current database schema representation.
   * - Compares the current schema with the last snapshot to detect changes.
   * - If changes are detected, prompts the user to run the migration generation command!
   */
  check = $command({
    name: "db:check-migrations",
    description: "Verify database migration files are up to date",
    args: t.optional(
      t.text({
        title: "path",
        description: "Path to the Alepha server entry file",
      }),
    ),
    flags: drizzleCommandFlags,
    handler: async ({ args, flags, root }) => {
      const rootDir = root;
      this.log.debug(`Using project root: ${rootDir}`);
      const { alepha } = await this.utils.loadAlephaFromServerEntryFile(
        rootDir,
        args,
      );

      const models: any[] = [];
      const repositories = alepha.descriptors("repository") as any[];
      const kit = createRequire(import.meta.url)("drizzle-kit/api");
      const migrationDir = join(rootDir, "migrations");

      const journalFile = await readFile(
        `${migrationDir}/meta/_journal.json`,
        "utf-8",
      ).catch(() => null);

      if (!journalFile) {
        this.log.info(`No migration journal found.`);
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

      for (const repository of repositories) {
        if (!models.includes(repository.table)) {
          models.push(repository.table);
        }
      }

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
    },
  });

  /**
   * Generate database migration files
   *
   * - Loads the Alepha instance from the specified entry file.
   * - Retrieves all repository descriptors to gather database models.
   * - Creates temporary entity definitions based on the current database schema.
   * - Writes these definitions to a temporary schema file. (node_modules/.db/entities.ts)
   * - Invokes Drizzle Kit's CLI to generate migration files based on the current schema.
   */
  generate = $command({
    name: "db:generate",
    description: "Generate migration files based on current database schema",
    summary: false,
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
      await this.utils.runDrizzleKitCommand({
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
   * Push database schema changes directly to the database
   *
   * - Loads the Alepha instance from the specified entry file.
   * - Retrieves all repository descriptors to gather database models.
   * - Creates temporary entity definitions and Drizzle config.
   * - Invokes Drizzle Kit's push command to apply schema changes directly.
   */
  push = $command({
    name: "db:push",
    description: "Push database schema changes directly to the database",
    summary: false,
    args: t.optional(
      t.text({
        title: "path",
        description: "Path to the Alepha server entry file",
      }),
    ),
    flags: drizzleCommandFlags,
    handler: async ({ root, args, flags }) => {
      await this.utils.runDrizzleKitCommand({
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
   *
   * - Loads the Alepha instance from the specified entry file.
   * - Retrieves all repository descriptors to gather database models.
   * - Creates temporary entity definitions and Drizzle config.
   * - Invokes Drizzle Kit's migrate command to apply pending migrations.
   */
  migrate = $command({
    name: "db:migrate",
    description: "Apply pending database migrations",
    summary: false,
    args: t.optional(
      t.text({
        title: "path",
        description: "Path to the Alepha server entry file",
      }),
    ),
    flags: drizzleCommandFlags,
    handler: async ({ root, args, flags }) => {
      await this.utils.runDrizzleKitCommand({
        root,
        args,
        command: "migrate",
        provider: flags.provider,
        logMessage: (providerName, dialect) =>
          `Migrate '${providerName}' database (${dialect}) ...`,
      });
    },
  });

  /**
   * Launch Drizzle Studio database browser
   *
   * - Loads the Alepha instance from the specified entry file.
   * - Retrieves all repository descriptors to gather database models.
   * - Creates temporary entity definitions and Drizzle config.
   * - Invokes Drizzle Kit's studio command to launch the web-based database browser.
   */
  studio = $command({
    name: "db:studio",
    description: "Launch Drizzle Studio database browser",
    summary: false,
    args: t.optional(
      t.text({
        title: "path",
        description: "Path to the Alepha server entry file",
      }),
    ),
    flags: drizzleCommandFlags,
    handler: async ({ root, args, flags }) => {
      await this.utils.runDrizzleKitCommand({
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
   * Drop database schema (development only)
   *
   * @experimental
   */
  drop = $command({
    name: "db:drop",
    description: "Drop database schema (development only)",
    summary: false,
    args: t.optional(
      t.text({
        title: "path",
        description: "Path to the Alepha server entry file",
      }),
    ),
    flags: drizzleCommandFlags,
    handler: async ({ flags }) => {
      // TODO: Implement db:drop
      this.log.warn("db:drop is not yet implemented");
      if (flags.provider) {
        this.log.info(`Provider filter: ${flags.provider}`);
      }
    },
  });

  /**
   * Seed database with initial data
   *
   * @experimental
   */
  seed = $command({
    name: "db:seed",
    description: "Seed database with initial data",
    summary: false,
    args: t.optional(
      t.text({
        title: "path",
        description: "Path to the Alepha server entry file",
      }),
    ),
    flags: drizzleCommandFlags,
    handler: async ({ flags }) => {
      // TODO: Implement db:seed
      this.log.warn("db:seed is not yet implemented");
      if (flags.provider) {
        this.log.info(`Provider filter: ${flags.provider}`);
      }
    },
  });

  /**
   * Show pending database migrations status
   *
   * @experimental
   */
  status = $command({
    name: "db:status",
    description: "Show pending database migrations status",
    summary: false,
    args: t.optional(
      t.text({
        title: "path",
        description: "Path to the Alepha server entry file",
      }),
    ),
    flags: drizzleCommandFlags,
    handler: async ({ flags }) => {
      // TODO: Implement db:status
      this.log.warn("db:status is not yet implemented");
      if (flags.provider) {
        this.log.info(`Provider filter: ${flags.provider}`);
      }
    },
  });
}
