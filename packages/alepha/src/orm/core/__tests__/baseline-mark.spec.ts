import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Alepha, AlephaError, z } from "alepha";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { $entity, $repository, db, sql } from "../index.ts";
import { DatabaseProvider } from "../providers/drivers/DatabaseProvider.ts";

const widgets = $entity({
  name: "widgets",
  schema: z.object({
    id: db.primaryKey(),
    name: z.text(),
  }),
});

class App {
  widgets = $repository(widgets);
}

/**
 * Write a single migration in the layout drizzle v1's migrator expects:
 * `<folder>/<14-digit-timestamp-prefixed-name>/migration.sql`.
 *
 * The SQL text is a `CREATE TABLE widgets` statement — it is never executed
 * by `markBaselineApplied`, which only records bookkeeping, so its exact
 * shape doesn't matter for these tests. What matters is that it exists, so
 * we can prove afterwards that it never ran.
 */
const writeBaselineMigration = (migrationsFolder: string, subdir: string) => {
  const dir = join(migrationsFolder, subdir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "migration.sql"),
    "CREATE TABLE `widgets` (\n\t`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`name` text NOT NULL\n);",
  );
};

describe("markBaselineApplied", () => {
  let migrationsFolder: string;

  beforeEach(() => {
    migrationsFolder = mkdtempSync(join(tmpdir(), "alepha-baseline-mark-"));
  });

  afterEach(() => {
    rmSync(migrationsFolder, { recursive: true, force: true });
  });

  /**
   * Boots a fresh in-memory sqlite app with push-based dev sync disabled.
   *
   * Push sync (`DrizzleKitProvider.synchronize`) would otherwise introspect
   * the registered `widgets` entity and create the table itself at startup,
   * which would make it impossible to tell whether `markBaselineApplied`
   * executed the baseline SQL or not.
   */
  const boot = async (): Promise<DatabaseProvider> => {
    const alepha = Alepha.create({
      env: { DATABASE_URL: "sqlite://:memory:", DATABASE_SYNC: false },
    });
    alepha.inject(App);
    await alepha.start();
    return alepha.inject(DatabaseProvider);
  };

  const tableExists = async (
    provider: DatabaseProvider,
    name: string,
  ): Promise<boolean> => {
    const rows = await provider.execute(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${name}`,
    );
    return rows.length > 0;
  };

  /**
   * The captured error from a rejected `markBaselineApplied()` call, so a
   * test can assert both the error type and its message from one invocation
   * instead of calling the (state-mutating) command twice.
   */
  const captureError = async (fn: () => Promise<unknown>): Promise<unknown> => {
    try {
      await fn();
      return undefined;
    } catch (error) {
      return error;
    }
  };

  /**
   * The baseline file is nothing but CREATE TABLE statements. Recording it
   * must never run them — that is the whole point of the command.
   */
  it("records the baseline as applied without executing its SQL", async () => {
    writeBaselineMigration(migrationsFolder, "20260729120000_baseline");
    const provider = await boot();

    // Sanity check: the table genuinely does not exist before the call.
    expect(await tableExists(provider, "widgets")).toBe(false);

    await provider.markBaselineApplied(migrationsFolder);

    const bookkeeping = await provider.execute(
      sql`SELECT name FROM __drizzle_migrations`,
    );
    expect(bookkeeping).toHaveLength(1);
    expect(bookkeeping[0]?.name).toBe("20260729120000_baseline");

    // The whole point: no CREATE TABLE from the baseline file ever ran.
    expect(await tableExists(provider, "widgets")).toBe(false);
  });

  it("refuses when the database already has migration rows", async () => {
    writeBaselineMigration(migrationsFolder, "20260729120000_baseline");
    const provider = await boot();
    await provider.markBaselineApplied(migrationsFolder);

    const error = await captureError(() =>
      provider.markBaselineApplied(migrationsFolder),
    );

    expect(error).toBeInstanceOf(AlephaError);
    expect((error as Error).message).toMatch(/already has migration rows/i);
  });

  it("refuses when more than one local migration exists", async () => {
    writeBaselineMigration(migrationsFolder, "20260729120000_first");
    writeBaselineMigration(migrationsFolder, "20260729120100_second");
    const provider = await boot();

    const error = await captureError(() =>
      provider.markBaselineApplied(migrationsFolder),
    );

    expect(error).toBeInstanceOf(AlephaError);
    expect((error as Error).message).toMatch(/more than one local migration/i);
  });

  /**
   * `alepha db baseline mark` loads the app via
   * `loadAlephaFromServerEntryFile`, which sets `ALEPHA_CLI_IMPORT` and so
   * never calls `alepha.start()` (see `core/index.ts`'s early return on that
   * flag). Database connections normally open in each provider's `start`
   * hook, so the CLI's container reaches `markBaselineApplied` UNCONNECTED —
   * `boot()` above, which calls `alepha.start()`, does not reproduce that.
   *
   * The CLI command is responsible for calling `provider.connect?.()` /
   * `provider.close?.()` around the call, mirroring `db push --dry-run`'s
   * existing pattern. This test reproduces that exact precondition instead
   * of the started-container shortcut.
   */
  it("works against an unstarted container, mirroring the CLI's precondition", async () => {
    writeBaselineMigration(migrationsFolder, "20260729120000_baseline");

    const alepha = Alepha.create({
      env: { DATABASE_URL: "sqlite://:memory:", DATABASE_SYNC: false },
    });
    alepha.inject(App);
    // Deliberately no `await alepha.start()`.
    const provider = alepha.inject(DatabaseProvider);

    await provider.connect?.();
    try {
      await provider.markBaselineApplied(migrationsFolder);

      const bookkeeping = await provider.execute(
        sql`SELECT name FROM __drizzle_migrations`,
      );
      expect(bookkeeping).toHaveLength(1);
    } finally {
      await provider.close?.();
    }
  });
});
