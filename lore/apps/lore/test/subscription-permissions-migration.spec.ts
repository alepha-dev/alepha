import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { Alepha } from "alepha";
import { AlephaOrm, DatabaseProvider } from "alepha/orm";
import { describe, it } from "vitest";

/**
 * Notifications take over from automations (#Q3890): the migration grants
 * `subscription:manage` wherever `automation:manage` is held,
 * `subscription:read` wherever `automation:read` is, and `subscription:*`
 * for `automation:*`, in ranks and in API keys, and is safe to run twice.
 * Proven on SQLite (D1's dialect) and, under `alepha test --dialect
 * postgres`, on Postgres.
 */
const onPostgres = process.env.DATABASE_TEST_DIALECT === "postgres";

describe("subscription permissions migration", () => {
  const migration = (dialect: "sqlite" | "postgres") =>
    readFileSync(
      join(
        import.meta.dirname,
        dialect === "sqlite"
          ? "../migrations/sqlite/20261118222242_event_subscriptions/migration.sql"
          : "../migrations/postgres/20261118222249_event_subscriptions/migration.sql",
      ),
      "utf8",
    );
  /**
   * The data half only: the table it creates is the schema's business.
   */
  const grants = (sql: string) =>
    sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter((statement) => statement.includes("subscription:"));
  const before: Record<string, string[]> = {
    admin: ["project:read", "automation:read", "automation:manage"],
    reader: ["project:read", "automation:read"],
    wildcard: ["automation:*"],
    member: ["project:read", "quest:read"],
    already: ["automation:read", "subscription:read"],
  };
  const after: Record<string, string[]> = {
    admin: [
      "project:read",
      "automation:read",
      "automation:manage",
      "subscription:manage",
      "subscription:read",
    ],
    reader: ["project:read", "automation:read", "subscription:read"],
    wildcard: ["automation:*", "subscription:*"],
    member: ["project:read", "quest:read"],
    already: ["automation:read", "subscription:read"],
  };

  it("grants subscription permissions where automation ones are held, on SQLite, twice over", ({
    expect,
  }) => {
    const db: any = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE organization_ranks (id text PRIMARY KEY, permissions text NOT NULL);
      CREATE TABLE api_keys (id text PRIMARY KEY, permissions text NOT NULL);
    `);
    for (const table of ["organization_ranks", "api_keys"]) {
      const insert = db.prepare(`INSERT INTO ${table} VALUES (?, ?)`);
      for (const [id, permissions] of Object.entries(before))
        insert.run(id, JSON.stringify(permissions));
    }
    for (let pass = 0; pass < 2; pass++)
      for (const statement of grants(migration("sqlite"))) db.exec(statement);
    for (const table of ["organization_ranks", "api_keys"]) {
      const rows = db.prepare(`SELECT id, permissions FROM ${table}`).all();
      expect(
        Object.fromEntries(
          rows.map((row: any) => [row.id, JSON.parse(row.permissions)]),
        ),
      ).toEqual(after);
    }
  });

  it.runIf(onPostgres)(
    "grants subscription permissions where automation ones are held, on Postgres, twice over",
    async ({ expect }) => {
      const alepha = Alepha.create({
        env: { DATABASE_URL: ":memory:", LOG_LEVEL: "error" },
      }).with(AlephaOrm);
      const database = alepha.inject(DatabaseProvider);
      await alepha.start();
      try {
        for (const table of ["organization_ranks", "api_keys"]) {
          await database.execute(
            `CREATE TABLE "${table}" ("id" text PRIMARY KEY, "permissions" text[] NOT NULL)`,
          );
          for (const [id, permissions] of Object.entries(before))
            await database.execute(
              `INSERT INTO "${table}" VALUES ('${id}', ARRAY[${permissions.map((it) => `'${it}'`).join(", ")}]::text[])`,
            );
        }
        for (let pass = 0; pass < 2; pass++)
          for (const statement of grants(migration("postgres")))
            await database.execute(statement);
        for (const table of ["organization_ranks", "api_keys"]) {
          const rows = await database.execute(
            `SELECT "id", "permissions" FROM "${table}"`,
          );
          expect(
            Object.fromEntries(rows.map((row) => [row.id, row.permissions])),
          ).toEqual(after);
        }
      } finally {
        await alepha.stop();
      }
    },
  );
});
