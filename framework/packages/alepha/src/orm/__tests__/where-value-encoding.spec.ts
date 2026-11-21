import { Alepha, z } from "alepha";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { describe, it } from "vitest";

import { $entity, $repository, db, DbError } from "../core/index.ts";

/**
 * A pattern is text for SQL, never encoded as a column value: `%abc%` is no
 * uuid or enum member. Value operators keep comparing the value as given.
 * On Postgres a uuid, a real enum, an array and a json column are not text:
 * every pattern operator reads those four as text there, as SQLite stores
 * them. No other type is cast.
 */

const tickets = $entity({
  name: "where_encoding_tickets",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    status: z.enum(["open", "closed"]),
    title: z.text(),
    tags: db.default(z.array(z.text()), []),
    meta: z.object({ kind: z.text() }).optional(),
    openedAt: z.datetime().optional(),
    dueOn: z.date().optional(),
    urgent: z.boolean().optional(),
    rank: z.integer().optional(),
  }),
});

class App {
  tickets = $repository(tickets);
}

const dialects: Array<[string, () => Alepha]> = [
  [
    "sqlite",
    () => Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
  ],
  ["postgres", () => Alepha.create().with(AlephaOrmTestPostgres)],
];

for (const [dialect, create] of dialects) {
  describe(`where-clause value encoding (${dialect})`, () => {
    const boot = async () => {
      const alepha = create();
      const app = alepha.inject(App);
      await alepha.start();
      const row = await app.tickets.create({
        status: "open",
        title: "first",
        tags: ["bug", "ui"],
        meta: { kind: "held" },
        openedAt: "2026-01-01T10:00:00.000Z",
        dueOn: "2026-01-02",
        urgent: false,
        rank: 7,
      });
      return { app, row };
    };

    it("passes a pattern operator on a uuid column through as text", async ({
      expect,
    }) => {
      const { app, row } = await boot();
      const fragment = String(row.id).slice(0, 8);

      const found = await app.tickets.findMany({
        where: { id: { contains: fragment } },
      });
      const prefixed = await app.tickets.findMany({
        where: { id: { startsWith: fragment } },
      });
      const liked = await app.tickets.findMany({
        where: { id: { like: `${fragment}%` } },
      });

      expect(found.map((it) => it.id)).toEqual([row.id]);
      expect(prefixed.map((it) => it.id)).toEqual([row.id]);
      expect(liked.map((it) => it.id)).toEqual([row.id]);
    });

    it("passes a pattern on an enum column through as text", async ({
      expect,
    }) => {
      const { app, row } = await boot();

      const found = await app.tickets.findMany({
        where: { status: { startsWith: "op" } },
      });

      expect(found.map((it) => it.id)).toEqual([row.id]);
    });

    it("still matches a valid value in eq and inArray", async ({ expect }) => {
      const { app, row } = await boot();

      const byEq = await app.tickets.findMany({
        where: { status: { eq: "open" } },
      });
      const byIn = await app.tickets.findMany({
        where: { status: { inArray: ["open", "closed"] } },
      });

      expect(byEq.map((it) => it.id)).toEqual([row.id]);
      expect(byIn.map((it) => it.id)).toEqual([row.id]);
    });

    it("matches every pattern operator on a uuid and an enum column", async ({
      expect,
    }) => {
      const { app, row } = await boot();
      const id = String(row.id);
      const ids = async (where: object) =>
        (await app.tickets.findMany({ where: where as never })).map(
          (it) => it.id,
        );

      expect(await ids({ id: { endsWith: id.slice(-6) } })).toEqual([row.id]);
      expect(
        await ids({ id: { ilike: `${id.slice(0, 8).toUpperCase()}%` } }),
      ).toEqual([row.id]);
      expect(await ids({ id: { notLike: `${id.slice(0, 8)}%` } })).toEqual([]);
      expect(await ids({ id: { notIlike: "zzz%" } })).toEqual([row.id]);
      expect(await ids({ status: { contains: "pe" } })).toEqual([row.id]);
      expect(await ids({ status: { endsWith: "sed" } })).toEqual([]);
      expect(await ids({ status: { like: "op%" } })).toEqual([row.id]);
      expect(await ids({ status: { ilike: "OP%" } })).toEqual([row.id]);
      expect(await ids({ title: { contains: "fir" } })).toEqual([row.id]);
    });

    it("matches contains / startsWith / endsWith on an array and a json column", async ({
      expect,
    }) => {
      const { app, row } = await boot();
      const ids = async (where: object) =>
        (await app.tickets.findMany({ where: where as never })).map(
          (it) => it.id,
        );

      expect(await ids({ tags: { contains: "bug" } })).toEqual([row.id]);
      expect(await ids({ tags: { contains: "feat" } })).toEqual([]);
      expect(await ids({ tags: { startsWith: '["bug"' } })).toEqual([row.id]);
      expect(await ids({ tags: { endsWith: '"ui"]' } })).toEqual([row.id]);
      expect(await ids({ meta: { contains: "held" } })).toEqual([row.id]);
      expect(await ids({ meta: { contains: "gone" } })).toEqual([]);
    });

    it("refuses a pattern on a timestamp, a date, a boolean and a number on postgres", async ({
      expect,
    }) => {
      // Their text differs between the dialects (a timestamp's also with the
      // session's time zone), so Postgres keeps its own refusal rather than
      // answer something SQLite would not.
      if (dialect !== "postgres") return;
      const { app } = await boot();

      for (const where of [
        { openedAt: { like: "2026-01-01%" } },
        { openedAt: { contains: "2026" } },
        { dueOn: { startsWith: "2026" } },
        { urgent: { ilike: "f%" } },
        { rank: { endsWith: "7" } },
      ]) {
        await expect(
          app.tickets.findMany({ where: where as never }),
          JSON.stringify(where),
        ).rejects.toThrow(DbError);
      }
    });
  });
}
