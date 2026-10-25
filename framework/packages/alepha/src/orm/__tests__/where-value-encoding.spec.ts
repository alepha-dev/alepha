import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";

import { $entity, $repository, db } from "../core/index.ts";

/**
 * A pattern is text for SQL, never encoded as a column value: `%abc%` is no
 * uuid or enum member. Value operators keep comparing the value as given.
 */

const tickets = $entity({
  name: "where_encoding_tickets",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    status: z.enum(["open", "closed"]),
    title: z.text(),
  }),
});

class App {
  tickets = $repository(tickets);
}

const boot = async () => {
  const alepha = Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } });
  const app = alepha.inject(App);
  await alepha.start();
  const row = await app.tickets.create({ status: "open", title: "first" });
  return { app, row };
};

describe("where-clause value encoding", () => {
  it("passes a pattern operator on a uuid column through as text", async () => {
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

  it("passes a pattern on an enum column through as text", async () => {
    const { app, row } = await boot();

    const found = await app.tickets.findMany({
      where: { status: { startsWith: "op" } },
    });

    expect(found.map((it) => it.id)).toEqual([row.id]);
  });

  it("still matches a valid value in eq and inArray", async () => {
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
});
