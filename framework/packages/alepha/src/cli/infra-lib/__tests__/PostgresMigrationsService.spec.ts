import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Alepha } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterEach, describe, it } from "vitest";

import { PostgresMigrationsService } from "../services/PostgresMigrationsService.ts";

const URL_ = String(process.env.POSTGRES_TEST_URL);

const writeMigration = async (
  dir: string,
  migration: { name: string; sql: string },
) => {
  await mkdir(join(dir, migration.name), { recursive: true });
  await writeFile(join(dir, migration.name, "migration.sql"), migration.sql);
};

const FIRST = {
  name: "20261112000000_baseline",
  sql: `CREATE TABLE "notes" (
\t"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
\t"body" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "notes_body_idx" ON "notes" ("body");`,
};
const SECOND = {
  name: "20261113093000_title",
  sql: `ALTER TABLE "notes" ADD COLUMN "title" text;`,
};

/**
 * The prebuilt deploy's Postgres migrator (#Q3508), against the compose
 * Postgres: a real server, since what is under test is drizzle's journal and
 * the advisory lock, which a fake cannot disagree with.
 */
describe("PostgresMigrationsService", () => {
  const schemas: string[] = [];
  const dirs: string[] = [];

  afterEach(async () => {
    const admin = postgres(URL_, { max: 1, onnotice: () => {} });
    for (const schema of schemas.splice(0)) {
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.unsafe(`DROP TABLE IF EXISTS drizzle."migrations_${schema}"`);
    }
    await admin.end();
    for (const dir of dirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  const newSchema = () => {
    const schema = `test_pgmig_${randomBytes(4).toString("hex")}`;
    schemas.push(schema);
    return schema;
  };

  const memoryService = async (migrations: Array<typeof FIRST>) => {
    const alepha = Alepha.create().with({
      provide: FileSystemProvider,
      use: MemoryFileSystemProvider,
    });
    const fs = alepha.inject(MemoryFileSystemProvider);
    for (const migration of migrations) {
      await fs.writeFile(
        `/artifact/migrations/postgres/${migration.name}/migration.sql`,
        migration.sql,
      );
    }
    return alepha.inject(PostgresMigrationsService);
  };

  const columns = async (schema: string) => {
    const client = postgres(URL_, { max: 1, onnotice: () => {} });
    const rows = await client`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = ${schema} AND table_name = 'notes'
      ORDER BY column_name`;
    const journal = await client.unsafe(
      `SELECT name, hash FROM drizzle."migrations_${schema}" ORDER BY id`,
    );
    await client.end();
    return { columns: rows.map((it) => it.column_name), journal };
  };

  it("builds the list drizzle's own folder reader builds, from a memory filesystem", async ({
    expect,
  }) => {
    const service = await memoryService([SECOND, FIRST]);
    const inMemory = await service.discover("/artifact/migrations/postgres");

    const dir = await mkdtemp(join(tmpdir(), "pgmig-"));
    dirs.push(dir);
    for (const migration of [FIRST, SECOND]) {
      await writeMigration(dir, migration);
    }
    expect(inMemory).toEqual(readMigrationFiles({ migrationsFolder: dir }));
  });

  it("applies the artifact's migrations once, into drizzle.migrations_<schema>", async ({
    expect,
  }) => {
    const schema = newSchema();
    const service = await memoryService([FIRST, SECOND]);
    const apply = () => service.apply({ url: URL_, schema, root: "/artifact" });

    expect(await apply()).toBe(2);
    expect(await apply()).toBe(0);

    const state = await columns(schema);
    expect(state.columns).toEqual(["body", "id", "title"]);
    expect(state.journal.map((it) => it.name)).toEqual([
      FIRST.name,
      SECOND.name,
    ]);
  });

  it("sees the pending set the CLI's folder migrator leaves, and the CLI sees its", async ({
    expect,
  }) => {
    const schema = newSchema();
    // The CLI path: drizzle's folder migrator, as NodePostgresProvider runs
    // it, on the same journal and search_path.
    const dir = await mkdtemp(join(tmpdir(), "pgmig-"));
    dirs.push(dir);
    await writeMigration(dir, FIRST);
    const client = postgres(URL_, { max: 1, onnotice: () => {} });
    await client.unsafe(`CREATE SCHEMA "${schema}"`);
    await client.unsafe(`SET search_path TO "${schema}", public`);
    await migrate(drizzle({ client }), {
      migrationsFolder: dir,
      migrationsTable: `migrations_${schema}`,
    });

    // The prebuilt migrator: only the second one is pending.
    const service = await memoryService([FIRST, SECOND]);
    expect(await service.apply({ url: URL_, schema, root: "/artifact" })).toBe(
      1,
    );

    // And the folder migrator, given both, finds nothing left to run.
    await writeMigration(dir, SECOND);
    await migrate(drizzle({ client }), {
      migrationsFolder: dir,
      migrationsTable: `migrations_${schema}`,
    });
    await client.end();
    expect((await columns(schema)).journal).toHaveLength(2);
  });

  it("serialises two deploys of one schema on the shared advisory lock", async ({
    expect,
  }) => {
    const schema = newSchema();
    const [a, b] = await Promise.all([
      memoryService([FIRST, SECOND]),
      memoryService([FIRST, SECOND]),
    ]);

    const applied = await Promise.all([
      a.apply({ url: URL_, schema, root: "/artifact" }),
      b.apply({ url: URL_, schema, root: "/artifact" }),
    ]);

    expect(applied.sort((a, b) => a - b)).toEqual([0, 2]);
    expect((await columns(schema)).journal).toHaveLength(2);
  });

  it("names the database, never the password, when it cannot connect", async ({
    expect,
  }) => {
    const service = await memoryService([FIRST]);
    const wrong = new URL(URL_);
    wrong.password = "s3cr3t-never-logged";

    let caught: unknown;
    try {
      await service.apply({ url: wrong.toString(), root: "/artifact" });
    } catch (error) {
      caught = error;
    }
    const chain: string[] = [];
    for (let it = caught as any; it; it = it.cause) {
      chain.push(String(it.message));
    }
    expect(chain[0]).toMatch(/^Could not connect to 127\.0\.0\.1:15432\//);
    expect(chain.join("\n")).not.toContain("s3cr3t-never-logged");
  });
});
