import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Alepha, z } from "alepha";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { $entity, $repository, db, sql } from "../index.ts";
import { DatabaseProvider } from "../providers/drivers/DatabaseProvider.ts";
import type { DrizzleKitPayload } from "../providers/DrizzleKitProvider.ts";
import { DrizzleKitProvider } from "../providers/DrizzleKitProvider.ts";

/**
 * The development sync against a database that already has the tables.
 *
 * `synchronize()` short-circuits under `NODE_ENV=test` into a from-scratch
 * generation, so every spec in this repo used to exercise a path `alepha dev`
 * never takes. These containers boot as `development` on purpose, against a
 * sqlite file that outlives them, so the second boot meets the first boot's
 * schema the way a developer's database meets a week of entity changes.
 */
const widgetsV1 = $entity({
  name: "widgets",
  schema: z.object({
    id: db.primaryKey(),
    name: z.text(),
  }),
});

/**
 * One column added.
 */
const widgetsV2 = $entity({
  name: "widgets",
  schema: z.object({
    id: db.primaryKey(),
    name: z.text(),
    size: z.number().optional(),
  }),
});

/**
 * `name` renamed to `label`: one column added and one removed on the same
 * table, which is the shape drizzle-kit wants to ask about. Nullable, because
 * sqlite refuses to add a NOT NULL column without a default to a table that
 * has rows, whichever tool asks.
 */
const widgetsV3 = $entity({
  name: "widgets",
  schema: z.object({
    id: db.primaryKey(),
    label: z.text().optional(),
    size: z.number().optional(),
  }),
});

const gadgets = $entity({
  name: "gadgets",
  schema: z.object({
    id: db.primaryKey(),
    name: z.text(),
  }),
});

class AppV1 {
  widgets = $repository(widgetsV1);
}

class AppV2 {
  widgets = $repository(widgetsV2);
}

class AppV3 {
  widgets = $repository(widgetsV3);
}

class AppV2WithGadgets {
  widgets = $repository(widgetsV2);
  gadgets = $repository(gadgets);
}

/**
 * A push that never works, standing in for a driver drizzle-kit cannot
 * introspect: what the fallback has to say is the point.
 */
class BrokenPushDrizzleKitProvider extends DrizzleKitProvider {
  protected override async callPushSchema(
    kit: DrizzleKitPayload,
    models: Record<string, unknown>,
    provider: DatabaseProvider,
  ): Promise<{
    sqlStatements: string[];
    hints: Array<{ hint: string; statement?: string }>;
    apply: () => Promise<void>;
  }> {
    void kit;
    void models;
    void provider;
    throw new Error("introspection is not available on this driver");
  }
}

describe("development schema sync against an existing database", () => {
  let dir: string;
  let file: string;
  const containers: Alepha[] = [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "alepha-dev-sync-"));
    file = join(dir, "dev.db");
  });

  afterEach(async () => {
    for (const alepha of containers.splice(0)) {
      await alepha.stop();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  const boot = async (
    App: new () => object,
    kitClass: typeof DrizzleKitProvider = DrizzleKitProvider,
  ) => {
    const alepha = Alepha.create({
      env: {
        NODE_ENV: "development",
        DATABASE_URL: `sqlite://${file}`,
        DATABASE_SYNC: false,
      },
    });
    if (kitClass !== DrizzleKitProvider) {
      alepha.with({ provide: DrizzleKitProvider, use: kitClass });
    }
    alepha.inject(App);
    await alepha.start();
    containers.push(alepha);
    const provider = alepha.inject(DatabaseProvider);
    const kit = alepha.inject(DrizzleKitProvider);
    return { alepha, provider, kit };
  };

  const columnsOf = async (provider: DatabaseProvider, table: string) =>
    (await provider.execute(sql.raw(`PRAGMA table_info(${table})`))).map(
      (row) => row.name,
    );

  it("adds a column the entity gained", async () => {
    const first = await boot(AppV1);
    expect((await first.kit.synchronize(first.provider)).complete).toBe(true);
    expect(await columnsOf(first.provider, "widgets")).toEqual(["id", "name"]);

    const second = await boot(AppV2);
    const result = await second.kit.synchronize(second.provider);

    expect(result.complete).toBe(true);
    expect(result.dropped).toEqual([]);
    expect(await columnsOf(second.provider, "widgets")).toEqual([
      "id",
      "name",
      "size",
    ]);
  });

  /**
   * drizzle-kit's programmatic `pushSchema` resolves a rename with the prompt
   * its CLI uses, which throws `resolver(column) was called without a
   * HintsHandler` when there is no terminal. A development push means "make
   * the database look like the entities", so the column it no longer
   * declares is dropped and the push runs again on a diff with only
   * additions in it.
   */
  it("resolves a renamed column as a drop and a create", async () => {
    const first = await boot(AppV2);
    await first.kit.synchronize(first.provider);
    await first.provider.execute(
      sql.raw("INSERT INTO widgets (id, name, size) VALUES ('1', 'one', 1)"),
    );

    const second = await boot(AppV3);
    const result = await second.kit.synchronize(second.provider);

    expect(result.complete).toBe(true);
    expect(result.dropped).toEqual(["widgets.name"]);
    expect(await columnsOf(second.provider, "widgets")).toEqual([
      "id",
      "size",
      "label",
    ]);
    // The rows survive: only the column went.
    const rows = await second.provider.execute(
      sql.raw("SELECT id, size FROM widgets"),
    );
    expect(rows).toEqual([{ id: "1", size: 1 }]);
  });

  it("drops a table no entity declares any more, once the push needs it", async () => {
    const first = await boot(AppV2WithGadgets);
    await first.kit.synchronize(first.provider);

    // Renaming a column is what forces the pre-pass; the orphan table goes
    // with it, exactly as drizzle-kit's own push would have dropped it.
    const second = await boot(AppV3);
    const result = await second.kit.synchronize(second.provider);

    expect(result.complete).toBe(true);
    expect(result.dropped).toEqual(["gadgets", "widgets.name"]);
    // `alepha_sequences` is the framework's own entity, registered on the
    // provider like any other, so it is declared and stays.
    const tables = await second.provider.execute(
      sql.raw(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      ),
    );
    expect(tables.map((row) => row.name)).toEqual([
      "alepha_sequences",
      "widgets",
    ]);
  });

  /**
   * The case that shipped "Synchronization OK" over a stale schema: the push
   * fails, the fallback creates the one new table, and the warning that
   * would have named the untouched ones only fired when NOTHING had been
   * applied.
   */
  it("reports an incomplete sync when the fallback leaves existing tables alone", async () => {
    const first = await boot(AppV1);
    await first.kit.synchronize(first.provider);

    const second = await boot(AppV2WithGadgets, BrokenPushDrizzleKitProvider);
    const result = await second.kit.synchronize(second.provider);

    // `gadgets` is new and was created; `widgets` exists and was skipped,
    // so its `size` column never arrived.
    expect(result.complete).toBe(false);
    expect(result.skipped).toBeGreaterThan(0);
    expect(result.pushError).toBeInstanceOf(Error);
    expect(await columnsOf(second.provider, "gadgets")).toEqual(["id", "name"]);
    expect(await columnsOf(second.provider, "widgets")).toEqual(["id", "name"]);
  });

  it("stays complete when the fallback had nothing to skip", async () => {
    const { kit, provider } = await boot(AppV1, BrokenPushDrizzleKitProvider);

    const result = await kit.synchronize(provider);

    expect(result.complete).toBe(true);
    expect(result.skipped).toBe(0);
    expect(await columnsOf(provider, "widgets")).toEqual(["id", "name"]);
  });

  /**
   * `alepha db push --dry-run` must not mutate anything, so it cannot take
   * the drops; it explains what it ran into instead of drizzle-kit's
   * "Internal error".
   */
  it("names the rename decision a dry run cannot take", async () => {
    const first = await boot(AppV2);
    await first.kit.synchronize(first.provider);

    const second = await boot(AppV3);

    await expect(second.kit.dryRunPush(second.provider)).rejects.toThrow(
      /rename/,
    );
    expect(await columnsOf(second.provider, "widgets")).toEqual([
      "id",
      "name",
      "size",
    ]);
  });
});
