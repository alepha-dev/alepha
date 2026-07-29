import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Alepha, AlephaError } from "alepha";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseProvider } from "../providers/drivers/DatabaseProvider.ts";

/**
 * Minimal concrete `DatabaseProvider` that never touches a real database —
 * only `migrate()`'s pre-`executeMigrations` guard is under test here, so
 * `executeMigrations` is stubbed to record whether it was ever reached
 * instead of actually running drizzle's migrator.
 */
class FakeDatabaseProvider extends DatabaseProvider {
  public migrationsFolderPath = "";
  public executeMigrationsCalls = 0;

  protected builder = {} as any;
  public db = {} as any;
  public dialect: "sqlite" = "sqlite";
  public url = "sqlite://fake";

  protected override getMigrationsFolder(): string {
    return this.migrationsFolderPath;
  }

  public async execute(): Promise<Record<string, unknown>[]> {
    return [];
  }

  protected override async executeMigrations(): Promise<void> {
    this.executeMigrationsCalls++;
  }
}

/**
 * `drizzle-orm@1`'s migrator (`readMigrationFiles`) hard-throws a bare
 * `Error` the instant it finds `<folder>/meta/_journal.json` — the
 * bookkeeping file every pre-v1 drizzle-kit project has:
 *
 *   "We detected that you have old drizzle-kit migration folders. You must
 *    upgrade drizzle-kit and run \"drizzle-kit up\""
 *
 * `drizzle-kit up` is not an Alepha command — no downstream consumer of
 * `alepha` who hasn't yet baselined onto v1 has any idea what that means.
 * `DatabaseProvider.migrate()` must catch this before it ever reaches
 * drizzle's migrator and point at the real remedy instead.
 */
describe("DatabaseProvider.migrate — pre-v1 layout guard", () => {
  let migrationsFolder: string;

  beforeEach(() => {
    migrationsFolder = mkdtempSync(join(tmpdir(), "alepha-migrate-guard-"));
  });

  afterEach(() => {
    rmSync(migrationsFolder, { recursive: true, force: true });
  });

  const boot = (): FakeDatabaseProvider => {
    const alepha = Alepha.create({ env: { NODE_ENV: "production" } });
    const provider = alepha.inject(FakeDatabaseProvider);
    provider.migrationsFolderPath = migrationsFolder;
    return provider;
  };

  it("refuses with an actionable error when a pre-v1 meta/_journal.json is present", async () => {
    mkdirSync(join(migrationsFolder, "meta"), { recursive: true });
    writeFileSync(join(migrationsFolder, "meta", "_journal.json"), "{}");
    const provider = boot();

    const error = await provider.migrate().then(
      () => undefined,
      (caught) => caught,
    );

    expect(error).toBeInstanceOf(AlephaError);
    expect((error as Error).message).toMatch(/alepha db baseline create/);
    expect((error as Error).message).toMatch(/alepha db baseline mark/);
    expect((error as Error).message).toMatch(
      /alepha platform db baseline mark/,
    );
    // The whole point: never even reach drizzle's migrator.
    expect(provider.executeMigrationsCalls).toBe(0);
  });

  it("still migrates normally when there is no pre-v1 journal", async () => {
    mkdirSync(join(migrationsFolder, "20260729000000_baseline"), {
      recursive: true,
    });
    writeFileSync(
      join(migrationsFolder, "20260729000000_baseline", "migration.sql"),
      "CREATE TABLE a(id integer);",
    );
    const provider = boot();

    await provider.migrate();

    expect(provider.executeMigrationsCalls).toBe(1);
  });

  it("skips migration entirely when the folder does not exist, without erroring", async () => {
    rmSync(migrationsFolder, { recursive: true, force: true });
    const provider = boot();

    await expect(provider.migrate()).resolves.toBeUndefined();
    expect(provider.executeMigrationsCalls).toBe(0);
  });
});
