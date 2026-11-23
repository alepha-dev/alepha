import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { Alepha } from "alepha";
import { AlephaOrm, DatabaseProvider } from "alepha/orm";
import { describe, it } from "vitest";

/**
 * Chat agents (#E170, #Q4197): a member's one conversation in a room was
 * `@lore`'s, so the migration moves it under the `lore` key of
 * `ai_conversations`, leaves a member without one alone, and is safe to run
 * twice. Proven on SQLite (D1's dialect) and, under `alepha test --dialect
 * postgres`, on Postgres.
 */
const onPostgres = process.env.DATABASE_TEST_DIALECT === "postgres";

describe("chat agent conversations migration", () => {
  const migration = (dialect: "sqlite" | "postgres") =>
    readFileSync(
      join(
        import.meta.dirname,
        dialect === "sqlite"
          ? "../migrations/sqlite/20261123171524_chat_agent_conversations/migration.sql"
          : "../migrations/postgres/20261123171532_chat_agent_conversations/migration.sql",
      ),
      "utf8",
    );
  const moves = (sql: string) =>
    sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter((statement) => statement.includes("UPDATE"));
  const conversation = "0190a5c4-0000-7000-8000-000000000001";

  it("moves each member's conversation under lore, on SQLite, twice over", ({
    expect,
  }) => {
    const db: any = new DatabaseSync(":memory:");
    db.exec(
      "CREATE TABLE chat_room_members (id text PRIMARY KEY, ai_conversation_id text, ai_conversations text)",
    );
    db.prepare("INSERT INTO chat_room_members VALUES (?, ?, NULL)").run(
      "talked",
      conversation,
    );
    db.prepare("INSERT INTO chat_room_members VALUES (?, NULL, NULL)").run(
      "quiet",
    );

    for (let pass = 0; pass < 2; pass++)
      for (const statement of moves(migration("sqlite"))) db.exec(statement);

    const rows = db
      .prepare("SELECT id, ai_conversations FROM chat_room_members")
      .all();
    expect(
      Object.fromEntries(
        rows.map((row: any) => [
          row.id,
          row.ai_conversations ? JSON.parse(row.ai_conversations) : null,
        ]),
      ),
    ).toEqual({ talked: { lore: conversation }, quiet: null });
  });

  it.runIf(onPostgres)(
    "moves each member's conversation under lore, on Postgres, twice over",
    async ({ expect }) => {
      const alepha = Alepha.create({
        env: { DATABASE_URL: ":memory:", LOG_LEVEL: "error" },
      }).with(AlephaOrm);
      const database = alepha.inject(DatabaseProvider);
      await alepha.start();
      try {
        await database.execute(
          `CREATE TABLE "chat_room_members" ("id" text PRIMARY KEY, "ai_conversation_id" uuid, "ai_conversations" jsonb)`,
        );
        await database.execute(
          `INSERT INTO "chat_room_members" VALUES ('talked', '${conversation}', NULL), ('quiet', NULL, NULL)`,
        );
        for (let pass = 0; pass < 2; pass++)
          for (const statement of moves(migration("postgres")))
            await database.execute(statement);
        const rows = await database.execute(
          `SELECT "id", "ai_conversations" FROM "chat_room_members"`,
        );
        expect(
          Object.fromEntries(rows.map((row) => [row.id, row.ai_conversations])),
        ).toEqual({ talked: { lore: conversation }, quiet: null });
      } finally {
        await alepha.stop();
      }
    },
  );
});
