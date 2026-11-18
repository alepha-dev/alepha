import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { Alepha } from "alepha";
import { AlephaOrm, DatabaseProvider } from "alepha/orm";
import { describe, it } from "vitest";

/**
 * Positions leave the graph (#Q3852): the migration rewrites
 * `automations.rule` and a health record's `automation_runs.snapshot.rule`
 * without `position`, keeps every other key and the nodes' order, leaves a
 * row with no position as it was, and is safe to run twice. Proven on a
 * synthetic dump shaped like production's rows, on SQLite (D1's dialect)
 * and, under `alepha test --dialect postgres`, on Postgres.
 */
const onPostgres = process.env.DATABASE_TEST_DIALECT === "postgres";

describe("automation positions out migration", () => {
  const migration = (dialect: "sqlite" | "postgres") =>
    readFileSync(
      join(
        import.meta.dirname,
        dialect === "sqlite"
          ? "../migrations/sqlite/20261118003813_automation_positions_out/migration.sql"
          : "../migrations/postgres/20261118003821_automation_positions_out/migration.sql",
      ),
      "utf8",
    );
  const statements = (sql: string) =>
    sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
  /**
   * A bell's merged presets as the canvas stored them: every node placed,
   * a source switched off.
   */
  const drawn = {
    version: 2,
    nodes: [
      {
        id: "feedback-created.source",
        kind: "source",
        type: "feedback.created",
        config: {},
        position: { x: 0, y: 0 },
      },
      {
        id: "feedback-created.action-1",
        kind: "action",
        type: "notify",
        config: {
          recipient: "0190a000-0000-7000-8000-000000000001",
          channels: ["inbox", "email"],
          title: "New feedback {{reference}}",
          text: "{{description}}",
          category: "automations",
        },
        position: { x: 280, y: 0 },
      },
      {
        id: "host-offline.source",
        kind: "source",
        type: "host.offline",
        config: { host: "bay-1" },
        enabled: false,
        position: { x: 0, y: 140 },
      },
      {
        id: "host-offline.action-1",
        kind: "action",
        type: "notify",
        config: {
          recipient: "0190a000-0000-7000-8000-000000000001",
          channels: ["inbox"],
          title: "Host offline",
          text: "{{host}}",
          category: "automations",
        },
        position: { x: 280, y: 140 },
      },
    ],
    edges: [
      {
        from: "feedback-created.source",
        port: "out",
        to: "feedback-created.action-1",
      },
      { from: "host-offline.source", port: "out", to: "host-offline.action-1" },
    ],
  };
  const bare = {
    ...drawn,
    nodes: drawn.nodes.map(({ position: _position, ...node }) => node),
  };
  const snapshot = (rule: unknown) => ({
    sourceNode: "feedback-created.source",
    inputs: { title: "Slow page" },
    counts: { selected: 1, matched: 1, executed: 1, totalIsExact: true },
    actions: [],
    rule,
  });

  it("rewrites every stored graph without positions on SQLite, twice over", ({
    expect,
  }) => {
    const db: any = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE automations (id text PRIMARY KEY, rule text NOT NULL);
      CREATE TABLE automation_runs (id text PRIMARY KEY, snapshot text NOT NULL);
    `);
    const untouched = JSON.stringify(bare);
    const insert = db.prepare("INSERT INTO automations VALUES (?, ?)");
    insert.run("drawn", JSON.stringify(drawn));
    insert.run("bare", untouched);
    const run = db.prepare("INSERT INTO automation_runs VALUES (?, ?)");
    run.run("health", JSON.stringify(snapshot(drawn)));
    run.run("subgraph", JSON.stringify(snapshot(bare)));
    run.run("redacted", JSON.stringify(snapshot(null)));
    for (let pass = 0; pass < 2; pass++)
      for (const statement of statements(migration("sqlite")))
        db.exec(statement);
    const rule = (id: string) =>
      db.prepare("SELECT rule FROM automations WHERE id = ?").get(id).rule;
    const runSnapshot = (id: string) =>
      JSON.parse(
        db.prepare("SELECT snapshot FROM automation_runs WHERE id = ?").get(id)
          .snapshot,
      );
    expect(JSON.parse(rule("drawn"))).toEqual(bare);
    expect(rule("bare")).toBe(untouched);
    expect(runSnapshot("health")).toEqual(snapshot(bare));
    expect(runSnapshot("subgraph")).toEqual(snapshot(bare));
    expect(runSnapshot("redacted")).toEqual(snapshot(null));
  });

  it.runIf(onPostgres)(
    "rewrites every stored graph without positions on Postgres, twice over",
    async ({ expect }) => {
      const alepha = Alepha.create({
        env: { DATABASE_URL: ":memory:", LOG_LEVEL: "error" },
      }).with(AlephaOrm);
      const database = alepha.inject(DatabaseProvider);
      await alepha.start();
      try {
        await database.execute(
          `CREATE TABLE "automations" ("id" text PRIMARY KEY, "rule" jsonb NOT NULL)`,
        );
        await database.execute(
          `CREATE TABLE "automation_runs" ("id" text PRIMARY KEY, "snapshot" jsonb NOT NULL)`,
        );
        const json = (value: unknown) =>
          `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
        await database.execute(
          `INSERT INTO "automations" VALUES ('drawn', ${json(drawn)}), ('bare', ${json(bare)})`,
        );
        await database.execute(
          `INSERT INTO "automation_runs" VALUES ('health', ${json(snapshot(drawn))}), ('subgraph', ${json(snapshot(bare))}), ('redacted', ${json(snapshot(null))})`,
        );
        for (let pass = 0; pass < 2; pass++)
          for (const statement of statements(migration("postgres")))
            await database.execute(statement);
        const rows = await database.execute(
          `SELECT "id", "rule" FROM "automations" ORDER BY "id"`,
        );
        const runs = await database.execute(
          `SELECT "id", "snapshot" FROM "automation_runs" ORDER BY "id"`,
        );
        const parse = (value: unknown) =>
          typeof value === "string" ? JSON.parse(value) : value;
        expect(
          Object.fromEntries(rows.map((row) => [row.id, parse(row.rule)])),
        ).toEqual({ bare, drawn: bare });
        expect(
          Object.fromEntries(runs.map((row) => [row.id, parse(row.snapshot)])),
        ).toEqual({
          health: snapshot(bare),
          redacted: snapshot(null),
          subgraph: snapshot(bare),
        });
      } finally {
        await alepha.stop();
      }
    },
  );
});
