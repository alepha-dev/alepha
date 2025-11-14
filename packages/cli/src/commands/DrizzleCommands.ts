import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { $command } from "@alepha/command";
import { $inject, Alepha, AlephaError, boot, t } from "@alepha/core";
import { $logger } from "@alepha/logger";
import { Repository } from "@alepha/postgres";
import { tsImport } from "tsx/esm/api";
import { ProcessRunner } from "../services/ProcessRunner.ts";

export class DrizzleCommands {
  log = $logger();
  runner = $inject(ProcessRunner);

  flags = t.object({
    root: t.text({ description: "Project root", default: "." }),
  });

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
    flags: this.flags,
    args: t.optional(
      t.text({
        title: "path",
        description: "Path to the Alepha server entry file",
      }),
    ),
    handler: async ({ flags, args }) => {
      const rootDir = join(process.cwd(), flags.root);
      this.log.debug(`Using project root: ${rootDir}`);
      const { alepha } = await this.loadAlephaFromServerEntryFile(
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
    flags: this.flags,
    args: t.optional(
      t.text({
        title: "path",
        description: "Path to the Alepha server entry file",
      }),
    ),
    handler: async ({ flags, args }) => {
      await this.runDrizzleKitCommand({
        flags,
        args,
        command: "generate",
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
    flags: this.flags,
    args: t.optional(
      t.text({
        title: "path",
        description: "Path to the Alepha server entry file",
      }),
    ),
    handler: async ({ flags, args }) => {
      await this.runDrizzleKitCommand({
        flags,
        args,
        command: "push",
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
    flags: this.flags,
    args: t.optional(
      t.text({
        title: "path",
        description: "Path to the Alepha server entry file",
      }),
    ),
    handler: async ({ flags, args }) => {
      await this.runDrizzleKitCommand({
        flags,
        args,
        command: "migrate",
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
    flags: this.flags,
    args: t.optional(
      t.text({
        title: "path",
        description: "Path to the Alepha server entry file",
      }),
    ),
    handler: async ({ flags, args }) => {
      await this.runDrizzleKitCommand({
        flags,
        args,
        command: "studio",
        logMessage: (providerName, dialect) =>
          `Launch Studio for '${providerName}' (${dialect}) ...`,
      });
    },
  });

  /**
   * Run a drizzle-kit command for all database providers
   */
  protected async runDrizzleKitCommand(options: {
    flags: { root: string };
    args?: string;
    command: string;
    logMessage: (providerName: string, dialect: string) => string;
  }): Promise<void> {
    const rootDir = join(process.cwd(), options.flags.root);
    this.log.debug(`Using project root: ${rootDir}`);

    const { alepha, entry } = await this.loadAlephaFromServerEntryFile(
      rootDir,
      options.args,
    );

    const kit = this.getKitFromAlepha(alepha);
    const accepted = new Set<string>([]);

    for (const descriptor of alepha.services(Repository)) {
      const provider = descriptor.provider;
      const providerName = provider.name;
      const dialect = provider.dialect;

      if (accepted.has(providerName)) {
        continue;
      }
      accepted.add(providerName);

      this.log.info("");
      this.log.info(options.logMessage(providerName, dialect));

      const drizzleConfigJsPath = await this.prepareDrizzleConfig({
        kit,
        provider,
        providerName,
        dialect,
        entry,
        rootDir,
      });

      await this.runner.exec(
        `drizzle-kit ${options.command} --config=${drizzleConfigJsPath}`,
      );
    }
  }

  /**
   * Prepare Drizzle configuration files for a provider
   */
  protected async prepareDrizzleConfig(options: {
    kit: any;
    provider: any;
    providerName: string;
    dialect: string;
    entry: string;
    rootDir: string;
  }): Promise<string> {
    const models = Object.keys(options.kit.getModels(options.provider));
    const entitiesJs = this.generateEntitiesJs(
      options.entry,
      options.providerName,
      models,
    );

    const entitiesJsPath = await this.runner.writeConfigFile(
      "entities.js",
      entitiesJs,
      options.rootDir,
    );

    const drizzleConfigJs =
      "export default " +
      JSON.stringify(
        {
          schema: entitiesJsPath,
          out: `./migrations/${options.providerName}`,
          dialect: options.dialect,
        },
        null,
        2,
      );

    return await this.runner.writeConfigFile(
      "drizzle.config.js",
      drizzleConfigJs,
      options.rootDir,
    );
  }

  /**
   * Get DrizzleKitProvider from Alepha instance
   */
  protected getKitFromAlepha(alepha: Alepha): any {
    // biome-ignore lint/complexity/useLiteralKeys: private key
    return alepha["registry"]
      .values()
      .find((it: any) => it.instance.constructor.name === "DrizzleKitProvider")
      ?.instance;
  }

  public async loadAlephaFromServerEntryFile(
    rootDir?: string,
    explicitEntry?: string,
  ): Promise<{
    alepha: Alepha;
    entry: string;
  }> {
    process.env.ALEPHA_SKIP_START = "true";

    const entry = await boot.getServerEntry(rootDir, explicitEntry);
    const mod = await tsImport(entry, {
      parentURL: import.meta.url,
    });

    this.log.debug(`Load entry: ${entry}`);

    // check if alepha is correctly exported
    if (mod.default instanceof Alepha) {
      return {
        alepha: mod.default,
        entry,
      };
    }

    // else, try with global variable
    const g: any = global;
    if (g.__alepha) {
      return {
        alepha: g.__alepha,
        entry,
      };
    }

    throw new AlephaError(
      `Could not find Alepha instance in entry file: ${entry}`,
    );
  }

  protected generateEntitiesJs(
    entry: string,
    provider: string,
    models: string[] = [],
  ) {
    return `
import "${entry}";
import { DrizzleKitProvider, Repository } from "@alepha/postgres";

const alepha = globalThis.__alepha;
const kit = alepha.inject(DrizzleKitProvider);
const provider = alepha.services(Repository).find((it) => it.provider.name === "${provider}").provider;
const models = kit.getModels(provider);

${models.map((it: string) => `export const ${it} = models["${it}"];`).join("\n")}

`.trim();
  }
}
