import { Alepha, z } from "alepha";
import { $entity, $repository, db } from "alepha/orm";
import { describe, it } from "vitest";
import { AlephaOrmPostgres } from "../postgres/index.ts";

/**
 * `createMany` returns rows index-aligned with its input, and callers
 * depend on it: a data importer rebuilds its old-id → new-id table by
 * zipping the two arrays. If the order ever drifted, every foreign key
 * in an import would be silently rewired to the wrong parent — no error,
 * just quietly corrupt data.
 *
 * The guarantee is documented on `createMany`; this pins it, including
 * across the internal batch boundary.
 */
const widget = $entity({
  name: "order_widgets",
  schema: z.object({
    id: db.primaryKey(),
    label: z.text(),
    position: z.integer(),
  }),
});

class App {
  widgets = $repository(widget);
}

describe("createMany preserves input order", () => {
  it("returns rows index-aligned with the input", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaOrmPostgres).with(App);
    const app = alepha.inject(App);
    await alepha.start();

    // Deliberately not alphabetical and not in id order, so a sort
    // anywhere in the path would show up.
    const input = [
      { label: "zulu", position: 0 },
      { label: "alpha", position: 1 },
      { label: "mike", position: 2 },
      { label: "bravo", position: 3 },
    ];

    const created = await app.widgets.createMany(input);

    expect(created).toHaveLength(input.length);
    expect(created.map((w) => w.label)).toEqual(input.map((w) => w.label));
    // The zip an importer actually performs.
    created.forEach((row, i) => {
      expect(row.position).toBe(input[i].position);
    });

    await alepha.stop();
  });

  it("preserves order across batch boundaries", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaOrmPostgres).with(App);
    const app = alepha.inject(App);
    await alepha.start();

    // batchSize deliberately smaller than the input, so the insert is
    // split and the chunks have to be reassembled in order.
    const input = Array.from({ length: 25 }, (_, i) => ({
      label: `w-${String(i).padStart(3, "0")}`,
      position: i,
    }));

    const created = await app.widgets.createMany(input, { batchSize: 4 });

    expect(created).toHaveLength(25);
    expect(created.map((w) => w.position)).toEqual(
      input.map((w) => w.position),
    );

    await alepha.stop();
  });
});
