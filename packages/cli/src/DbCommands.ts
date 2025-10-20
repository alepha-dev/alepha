import "tsx";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { $command } from "@alepha/command";
import { type Alepha, AlephaError, t } from "@alepha/core";
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

  check = $command({
    name: "db:check",
    description: "Verify database migration files are up to date",
    summary: false,
    flags: this.flags,
    handler: async ({ flags }) => {
      const rootDir = join(process.cwd(), flags.root);
      const { alepha, entry } = await this.load(rootDir, flags.entry);
      const models: any[] = [];
      const repositories = alepha.descriptors("repository") as any[];
      const kit = createRequire(import.meta.url)("drizzle-kit/api");
      const migrationDir = join(rootDir, "migrations");
      const journal = JSON.parse(
        await readFile(`${migrationDir}/meta/_journal.json`, "utf-8"),
      );

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
    process.env.VITE_ALEPHA_DEV = "true";

    const paths = entry.split(",").map((p) => p.trim());
    for (const path of paths) {
      try {
        const entry = join(rootDir, path);
        await tsImport(entry, import.meta.url);
        const g: any = global;
        if (g.__alepha) {
          this.log.debug(`Load entry: ${path}`);
          return {
            alepha: g.__alepha,
            entry,
          };
        }
      } catch (e) {
        console.log(e);
        // continue to next path
      }
    }
    throw new AlephaError("No valid entry file found.");
  }
}
