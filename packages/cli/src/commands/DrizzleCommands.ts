import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { $command } from "@alepha/command";
import { Alepha, AlephaError, boot, t } from "@alepha/core";
import { $logger } from "@alepha/logger";
import { tsImport } from "tsx/esm/api";
import { exec } from "../helpers/exec.ts";

export class DrizzleCommands {
  log = $logger();

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
    handler: async ({ flags }) => {
      const rootDir = join(process.cwd(), flags.root);
      this.log.debug(`Using project root: ${rootDir}`);
      const { alepha } = await this.loadAlephaFromServerEntryFile(rootDir);

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
    handler: async ({ flags }) => {
      const rootDir = join(process.cwd(), flags.root);
      this.log.debug(`Using project root: ${rootDir}`);

      const { alepha, entry } =
        await this.loadAlephaFromServerEntryFile(rootDir);

      const inject = (name: string) =>
        // biome-ignore lint/complexity/useLiteralKeys: private key
        alepha["registry"]
          .values()
          .find((it: any) => it.instance.constructor.name === name)?.instance;

      const kit = inject("DrizzleKitProvider");
      const provider = (alepha.descriptors("repository")[0] as any).provider;
      const models = Object.keys(kit.getModels(provider));

      await writeFile(
        join(rootDir, "node_modules/.alepha/entities.js"),
        `
import "../..${entry.replace(rootDir, "")}";
import { DrizzleKitProvider } from "@alepha/postgres";

const alepha = globalThis.__alepha;
const kit = alepha.inject(DrizzleKitProvider);
const provider = alepha.descriptors("repository")[0].provider;
const models = kit.getModels(provider);

${models.map((it: string) => `export const ${it} = models["${it}"];`).join("\n")}

`.trim(),
      );

      await writeFile(
        join(rootDir, "node_modules/.alepha/drizzle.config.js"),
        "export default " +
          JSON.stringify(
            {
              schema: "./node_modules/.alepha/entities.js",
              out: "./migrations",
              dialect: "postgresql",
            },
            null,
            2,
          ),
      );

      await exec(
        `drizzle-kit generate --config ./node_modules/.alepha/drizzle.config.js`,
      );
    },
  });

  public async loadAlephaFromServerEntryFile(rootDir?: string): Promise<{
    alepha: Alepha;
    entry: string;
  }> {
    process.env.ALEPHA_SKIP_START = "true";

    const entry = await boot.getServerEntry(rootDir);
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
}
