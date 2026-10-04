import { $inject, AlephaError, z } from "alepha";
import {
  CloudflareApi,
  D1MigrationsService,
  NamingService,
  PlatformOrchestrator,
} from "alepha/cli/platform-lib";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";

import { DumpSplitter } from "./DumpSplitter.ts";
import { RehearsalDiff } from "./RehearsalDiff.ts";

/**
 * `alepha rehearse`: apply the pending migrations to a throwaway copy of
 * production and prove that no row moved (#Q2603, #E74).
 *
 * ⚠️ **The copy is a REMOTE D1 and the migrations go through
 * `D1MigrationsService.apply`**, the import flow `platform up` uses. That flow
 * honoured `PRAGMA foreign_keys=OFF` when measured on 2026-09-07 and the query
 * endpoint did not, so a rehearsal on local SQLite, or through `wrangler d1
 * execute --command`, would rehearse a different transport (folio #F1359).
 *
 * Runs from the `Rehearse migration` workflow, never from a laptop: the export
 * is every production row, users and emails included, and it must not leave
 * an ephemeral runner. It prints table names and counts only, and deletes the
 * copy and the dump whatever happens; the workflow repeats that cleanup in an
 * `always()` step in case this process dies first.
 */
export class RehearseMigrationCommand {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly orchestrator = $inject(PlatformOrchestrator);
  protected readonly naming = $inject(NamingService);
  protected readonly cloudflare = $inject(CloudflareApi);
  protected readonly migrations = $inject(D1MigrationsService);
  protected readonly diff = $inject(RehearsalDiff);
  protected readonly splitter = $inject(DumpSplitter);

  /**
   * The throwaway database. A fixed name, so a copy a crashed run left behind
   * is found and deleted by the next one, and by the workflow's cleanup step.
   */
  public static readonly COPY = "lore-rehearsal";

  public readonly rehearse = $command({
    name: "rehearse",
    description:
      "Apply the pending migrations to a throwaway copy of the deployed D1 and compare row counts.",
    flags: z.object({
      env: z
        .text({ description: "The environment whose database is copied." })
        .optional(),
    }),
    handler: async ({ flags, root, run }) => {
      const target = await this.orchestrator.resolveEnvironment(
        root,
        flags.env ?? "production",
      );
      const source = this.naming
        .forContext(target.config.project, target.env)
        .d1();
      const dir = this.fs.join(root, "node_modules", ".alepha", "rehearsal");
      const dump = this.fs.join(dir, `${source}.sql`);

      await this.deleteCopy();
      await this.fs.mkdir(dir, { recursive: true });

      try {
        await run(`wrangler d1 export ${source} --remote --output="${dump}"`, {
          alias: `export D1 ${source}`,
        });
        await this.escapeNulBytes(dump);
        await this.prepareDump(dump);

        const copy = await this.cloudflare.createD1(
          RehearseMigrationCommand.COPY,
        );
        // The dump goes in through wrangler's own `--file` path, the same
        // import flow, which names what it refuses: D1's import endpoint
        // driven directly answered a production dump with an error and no
        // reason (2026-10-04). The MIGRATIONS still go through
        // `D1MigrationsService` below, which is the transport under test.
        await run(
          `wrangler d1 execute ${RehearseMigrationCommand.COPY} --remote --yes --file="${dump}"`,
          { alias: `import the dump into ${RehearseMigrationCommand.COPY}` },
        );
        // The dump has done its job: production rows live only in the copy
        // from here on.
        await this.fs.rm(dump, { force: true });

        const before = await this.countRows(copy.uuid);
        const pending = await this.pendingSql(root, copy.uuid);
        this.log.info(
          `Pending on the copy: ${pending.length === 0 ? "none" : pending.map((it) => it.name).join(", ")}`,
        );

        await this.migrations.apply(
          this.cloudflare,
          RehearseMigrationCommand.COPY,
          root,
        );

        const after = await this.countRows(copy.uuid);
        const report = this.diff.compare(
          before,
          after,
          pending.map((it) => it.sql),
        );

        for (const row of report.rows) {
          this.log.info(
            `${row.status.padEnd(8)} ${row.table.padEnd(40)} ${String(row.before ?? "-").padStart(8)} -> ${String(row.after ?? "-").padStart(8)}`,
          );
        }

        if (report.failures.length > 0) {
          throw new AlephaError(
            `The rehearsal failed:\n${report.failures.map((it) => `  - ${it}`).join("\n")}`,
          );
        }
        this.log.info(
          `Rehearsal passed: ${pending.length} migration(s), ${report.rows.length} table(s) checked.`,
        );
      } finally {
        await this.fs.rm(dir, { recursive: true, force: true });
        await this.deleteCopy();
      }
    },
  });

  /**
   * Delete the copy if one exists. Idempotent, so it runs before a rehearsal
   * (a leftover) and after one (this run's).
   */
  protected async deleteCopy(): Promise<void> {
    const databases = await this.cloudflare.listD1();
    for (const database of databases) {
      if (database.name === RehearseMigrationCommand.COPY) {
        await this.cloudflare.deleteD1(database.uuid);
        this.log.info(`Deleted ${RehearseMigrationCommand.COPY}`);
      }
    }
  }

  /**
   * Every table's row count, `sqlite_*` and Cloudflare's `_cf_*` aside, in one
   * query.
   */
  protected async countRows(
    databaseId: string,
  ): Promise<Record<string, number>> {
    const [listed] = await this.cloudflare.d1Query(
      databaseId,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name;",
    );
    const tables = (listed?.results ?? [])
      .map((row) => row.name)
      .filter((name): name is string => typeof name === "string");
    if (tables.length === 0) {
      throw new AlephaError("The copy holds no table: the import failed.");
    }

    const sql = tables
      .map(
        (table) =>
          `SELECT '${table.replace(/'/g, "''")}' AS name, COUNT(*) AS n FROM "${table.replace(/"/g, '""')}"`,
      )
      .join(" UNION ALL ");
    const [counted] = await this.cloudflare.d1Query(databaseId, `${sql};`);

    const counts: Record<string, number> = {};
    for (const row of counted?.results ?? []) {
      counts[String(row.name)] = Number(row.n);
    }
    return counts;
  }

  /**
   * The migrations the copy has not applied, by the same rule
   * `D1MigrationsService` uses: a `<dir>/migration.sql` whose directory name is
   * not in the copy's `d1_migrations`.
   */
  protected async pendingSql(
    root: string,
    databaseId: string,
  ): Promise<Array<{ name: string; sql: string }>> {
    const [answer] = await this.cloudflare.d1Query(
      databaseId,
      "SELECT name FROM d1_migrations;",
    );
    const applied = new Set(
      (answer?.results ?? []).map((row) => String(row.name)),
    );
    if (applied.size === 0) {
      throw new AlephaError(
        "The copy records no applied migration: refusing to replay the whole history onto production rows.",
      );
    }

    const dir = this.fs.join(root, "migrations", "sqlite");
    const pending: Array<{ name: string; sql: string }> = [];
    for (const entry of (await this.fs.ls(dir)).sort()) {
      const name = entry.split("/").pop() as string;
      const path = this.fs.join(dir, name, "migration.sql");
      if (!applied.has(name) && (await this.fs.exists(path))) {
        pending.push({ name, sql: await this.fs.readTextFile(path) });
      }
    }
    return pending;
  }

  /**
   * Make the export importable into D1, without changing a row.
   *
   * - **`PRAGMA foreign_keys=OFF` in front.** The export writes each table's
   *   rows right after its `CREATE`, in `sqlite_master` order, so a child's
   *   rows can arrive before its parent table exists, and D1 refuses them
   *   ("no such table: main.projects", 2026-10-04). Production's rows are
   *   already consistent, and the import flow honours the pragma. It covers
   *   this file only: the migrations that follow are separate imports, which
   *   run with foreign keys on, as they do in production.
   * - **Over-long INSERTs split** by `DumpSplitter`: D1 refuses a statement
   *   over 100 KB, and a production row can be longer than that.
   */
  protected async prepareDump(path: string): Promise<void> {
    const { sql, rewritten } = this.splitter.split(
      await this.fs.readTextFile(path),
    );
    if (rewritten > 0) {
      this.log.info(`Split ${rewritten} over-long INSERT(s) in the dump`);
    }
    await this.fs.writeFile(path, `PRAGMA foreign_keys=OFF;\n${sql}`);
  }

  /**
   * `wrangler d1 export` writes a raw NUL byte where a text value holds one,
   * which a SQL text import cannot carry. Escaped the way `alepha platform db
   * export` does it (`CloudflareAdapter.escapeNulBytes`, protected there): it
   * alters such a value in the copy and moves no row count.
   */
  protected async escapeNulBytes(path: string): Promise<void> {
    const dump = await this.fs.readFile(path);
    const escape = Buffer.from("\\0", "latin1");
    const parts: Uint8Array[] = [];
    let start = 0;
    let at = dump.indexOf(0, start);
    while (at !== -1) {
      parts.push(dump.subarray(start, at), escape);
      start = at + 1;
      at = dump.indexOf(0, start);
    }
    if (parts.length === 0) return;
    parts.push(dump.subarray(start));
    await this.fs.writeFile(path, Buffer.concat(parts));
    this.log.warn(`Escaped ${parts.length >> 1} raw NUL byte(s) in the dump`);
  }
}
