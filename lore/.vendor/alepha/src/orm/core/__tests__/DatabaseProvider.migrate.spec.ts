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
  public dialect = "sqlite" as const;
  public url = "sqlite://fake";

  /**
   * Register an entity without going through `registerEntity`, which would
   * call into the table builder. Only the count matters to `migrate()`.
   */
  public declareEntity(): void {
    this.entityPrimitives.push({} as any);
  }

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

/**
 * Production has no push-sync fallback: `synchronize()` lives in the dev/test
 * branch. So in production an absent migrations folder does not mean "push the
 * schema for me", it means "create nothing" — and an app with entities then
 * boots green with no tables and throws `DbTableNotFoundError` on its first
 * query. A warning in startup logs is not where that should surface.
 *
 * The guard turns it into a boot failure, so a deploy goes red instead of a
 * user's first request. It has to stay narrow: an app with no entities has
 * nothing to create and must still boot, and `DATABASE_SYNC=false` already
 * means "I manage the schema myself", which is the difference between an
 * intentional choice and an omission.
 */
describe("DatabaseProvider.migrate — missing migrations in production", () => {
  let migrationsFolder: string;

  beforeEach(() => {
    migrationsFolder = mkdtempSync(join(tmpdir(), "alepha-migrate-missing-"));
    rmSync(migrationsFolder, { recursive: true, force: true });
  });

  const boot = (env: Record<string, unknown> = {}): FakeDatabaseProvider => {
    const alepha = Alepha.create({
      env: { NODE_ENV: "production", ...env },
    });
    const provider = alepha.inject(FakeDatabaseProvider);
    provider.migrationsFolderPath = migrationsFolder;
    return provider;
  };

  it("should refuse to boot when entities are declared and no migrations exist", async () => {
    const provider = boot();
    provider.declareEntity();

    const error = await provider.migrate().then(
      () => undefined,
      (caught) => caught,
    );

    expect(error).toBeInstanceOf(AlephaError);
    expect(provider.executeMigrationsCalls).toBe(0);
  });

  it("should name the command that fixes it", async () => {
    const provider = boot();
    provider.declareEntity();

    const error = await provider.migrate().then(
      () => undefined,
      (caught) => caught,
    );

    expect((error as Error).message).toMatch(/alepha db migrations create/);
  });

  /**
   * An app that mounts the ORM but declares nothing has no schema to create.
   * Refusing there would break a legitimate boot.
   */
  it("should still boot when no entities are declared", async () => {
    const provider = boot();

    await expect(provider.migrate()).resolves.toBeUndefined();
    expect(provider.executeMigrationsCalls).toBe(0);
  });

  /**
   * The escape hatch, on the flag that already means it. Someone applying DDL
   * out of band has said so; that is intent, not omission.
   */
  it("should still boot when DATABASE_SYNC is explicitly false", async () => {
    const provider = boot({ DATABASE_SYNC: false });
    provider.declareEntity();

    await expect(provider.migrate()).resolves.toBeUndefined();
    expect(provider.executeMigrationsCalls).toBe(0);
  });

  it("should not interfere outside production", async () => {
    const alepha = Alepha.create({
      env: { NODE_ENV: "test", DATABASE_SYNC: false },
    });
    const provider = alepha.inject(FakeDatabaseProvider);
    provider.migrationsFolderPath = migrationsFolder;
    provider.declareEntity();

    await expect(provider.migrate()).resolves.toBeUndefined();
  });
});
