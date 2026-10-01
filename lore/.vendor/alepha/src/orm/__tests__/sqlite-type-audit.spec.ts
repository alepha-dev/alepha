import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";

import {
  $entity,
  $repository,
  db,
  RepositoryProvider,
  sql,
  SqliteTypeAuditService,
} from "../core/index.ts";
import { AlephaOrmPostgres } from "../postgres/index.ts";

const events = $entity({
  name: "audit_events",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    name: z.text(),
    weight: z.number(),
    payload: z.record(z.text(), z.any()).optional(),
    createdAt: db.createdAt(),
  }),
});

class App {
  events = $repository(events);
}

/**
 * The check `db migrations check` cannot make: whether the ROWS agree with
 * the schema. A non-STRICT SQLite table stores an ISO string in an integer
 * column without a word, and that one row then sorts ahead of every other
 * (quest #1672). Seeded through raw SQL, since the ORM itself never writes
 * one.
 */
describe("SqliteTypeAuditService", () => {
  const setup = async () => {
    const alepha = Alepha.create({
      env: { DATABASE_URL: "sqlite://:memory:" },
    });
    const app = alepha.inject(App);
    await alepha.start();
    const provider = alepha
      .inject(RepositoryProvider)
      .getRepositories()[0].provider;
    return {
      alepha,
      app,
      provider,
      audit: alepha.inject(SqliteTypeAuditService),
    };
  };

  it("plans one statement per table over its integer, real and text columns only", async () => {
    const { alepha, audit, provider } = await setup();

    const plan = audit.plan(provider);
    const table = plan.find((it) => it.table === "audit_events");

    expect(table).toBeDefined();
    // `payload` is json-as-text and IS checked (a json column is text);
    // what is left out is only a type that takes anything.
    expect(table?.columns.sort()).toEqual(
      ["created_at", "id", "name", "payload", "weight"].sort(),
    );
    expect(table?.sql).toContain(
      "typeof(`created_at`) NOT IN ('integer', 'null')",
    );
    expect(table?.sql).toContain(
      "typeof(`weight`) NOT IN ('real', 'integer', 'null')",
    );
    expect(table?.sql).toContain("typeof(`name`) NOT IN ('text', 'null')");

    await alepha.stop();
  });

  it("answers nothing for a table the ORM has written correctly", async () => {
    const { alepha, app, audit, provider } = await setup();
    await app.events.create({ name: "clean", weight: 1.5 });
    await app.events.create({ name: "whole", weight: 2, payload: { a: 1 } });

    expect(await audit.audit(provider)).toEqual([]);

    await alepha.stop();
  });

  it("reports the column, the declared type and the rows per storage class", async () => {
    const { alepha, app, audit, provider } = await setup();
    await app.events.create({ name: "clean", weight: 1 });
    // What a hand-run statement does to a non-STRICT table: the ISO string
    // lands as TEXT, and a word in a REAL column too.
    await provider.execute(
      sql.raw(
        `INSERT INTO "audit_events" ("name", "weight", "created_at") VALUES ('bad', 2, '2026-08-10T17:16:44.766Z')`,
      ),
    );
    await provider.execute(
      sql.raw(
        `INSERT INTO "audit_events" ("name", "weight", "created_at") VALUES ('worse', 'heavy', '2026-08-10T17:18:29.254Z')`,
      ),
    );

    const drift = await audit.audit(provider);

    expect(drift).toEqual(
      expect.arrayContaining([
        {
          table: "audit_events",
          column: "created_at",
          declared: "integer",
          found: { text: 2 },
        },
        {
          table: "audit_events",
          column: "weight",
          declared: "real",
          found: { text: 1 },
        },
      ]),
    );
    expect(drift).toHaveLength(2);

    await alepha.stop();
  });

  /**
   * A database whose schema lags the code: the column the entity declares
   * is not there yet. SQLite would happily read a double-quoted name that
   * matches nothing as a string literal, and `typeof('weight')` is `text`
   * on every row, which is exactly the drift this audit exists to find.
   * The identifier has to fail, not match.
   */
  it("fails on a column the database does not have rather than counting a literal", async () => {
    const { alepha, app, audit, provider } = await setup();
    await app.events.create({ name: "clean", weight: 1 });
    await provider.execute(
      sql.raw(`ALTER TABLE "audit_events" DROP COLUMN "weight"`),
    );

    await expect(audit.audit(provider)).rejects.toThrow(/weight/);

    await alepha.stop();
  });

  it("has nothing to say about postgres, which refuses the value at the wire", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.inject(App);
    await alepha.start();
    const provider = alepha
      .inject(RepositoryProvider)
      .getRepositories()[0].provider;

    expect(alepha.inject(SqliteTypeAuditService).plan(provider)).toEqual([]);
    expect(await alepha.inject(SqliteTypeAuditService).audit(provider)).toEqual(
      [],
    );

    await alepha.stop();
  });
});
