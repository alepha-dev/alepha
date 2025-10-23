import "tsx";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { $command } from "@alepha/command";
import { Alepha, AlephaError, t } from "@alepha/core";
import { $logger } from "@alepha/logger";
import { tsImport } from "tsx/esm/api";

export class DbCommands {
  log = $logger();

  flags = t.object({
    entry: t.text({
      description: "Server entry file",
      default: "src/index.server.ts,src/index.ts",
    }),
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
    name: "db:check",
    description: "Verify database migration files are up to date",
    summary: false,
    flags: this.flags,
    handler: async ({ flags }) => {
      const rootDir = join(process.cwd(), flags.root);
      const { alepha } = await this.load(rootDir, flags.entry);
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
      process.argv[2] = "generate";
      process.argv[3] = "--config";
      process.argv[4] = "./node_modules/.db/kit.ts";

      const rootDir = join(process.cwd(), flags.root);
      this.log.debug(`Using project root: ${rootDir}`);
      const { alepha, entry } = await this.load(rootDir, flags.entry);
      const repositories = alepha.descriptors("repository") as any[];

      try {
        await mkdir(join(rootDir, "node_modules/.db"), {
          recursive: true,
        });
      } catch {}

      const entities = [
        ...new Set([...repositories.map((it) => it.tableName)]),
      ];

      await writeFile(
        join(rootDir, "node_modules/.db/entities.ts"),
        `
import "../..${entry.replace(rootDir, "")}";

const alepha = (global as any).__alepha;
const repositories = alepha.descriptors("repository");
const table = (name: string) => repositories.find((it: any) => it.tableName === name)!.table;

${entities.map((it) => `export const ${it} = table("${it}");`).join("\n")}

				`.trim(),
      );

      await writeFile(
        join(rootDir, "node_modules/.db/kit.ts"),
        "export default " +
          JSON.stringify(
            {
              schema: "./node_modules/.db/entities.ts",
              out: "./migrations",
              dialect: "postgresql",
            },
            null,
            4,
          ),
      );

      const drizzle = createRequire(import.meta.url)
        .resolve("drizzle-kit")
        .replace("index.js", "bin.cjs");

      await import(drizzle);
    },
  });

  public async load(
    rootDir: string,
    entry: string,
  ): Promise<{
    alepha: Alepha;
    entry: string;
  }> {
    process.env.ALEPHA_SKIP_START = "true";

    const paths = entry.split(",").map((p) => p.trim());
    for (const path of paths) {
      try {
        const entry = join(rootDir, path);
        const mod = await tsImport(entry, import.meta.url);

        this.log.debug(`Load entry: ${path}`);

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
      } catch {
        // continue to next path
      }
    }

    throw new AlephaError("No valid entry file found.");
  }
}
