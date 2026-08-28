import { Alepha, z } from "alepha";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { $entity, $repository, db } from "../core/index.ts";

/**
 * A defaulted column is still `NOT NULL` - the default is exactly what fills
 * it. The model builders used to read `z.schema.requiredKeys`, which answers
 * the different question of whether a CALLER must supply the key; once that
 * helper stopped counting defaulted fields as required, reusing it here would
 * have quietly dropped `NOT NULL` from every defaulted column and rewritten
 * the migration snapshot of every app.
 */
const rows = $entity({
  name: "test_not_null_rows",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    // The two ways a default is declared: a zod `.default()` wrapper, and the
    // ORM's own `db.default` (an own property, not a wrapper).
    severity: z.enum(["info", "warning"]).default("info"),
    weight: db.default(z.integer(), 1),
    label: z.text(),
    note: z.text().optional(),
  }),
});

class App {
  rows = $repository(rows);
}

describe("NOT NULL on a defaulted column", () => {
  it("should keep NOT NULL on defaulted columns and drop it on optional ones", async () => {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", DATABASE_URL: "sqlite://:memory:" },
    });
    const app = alepha.inject(App);
    await alepha.start();

    const columns = await app.rows.query(
      sql`PRAGMA table_info(test_not_null_rows)`,
      z.object({ name: z.text(), notnull: z.integer() }),
    );
    const notNull = Object.fromEntries(
      columns.map((it) => [it.name, it.notnull === 1]),
    );

    expect(notNull).toMatchObject({
      severity: true,
      weight: true,
      label: true,
      note: false,
    });
  });
});
