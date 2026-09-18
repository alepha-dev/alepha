import { Alepha, z } from "alepha";
import {
  DatabaseProvider,
  NodeSqliteProvider,
  nodeSqliteOptions,
} from "alepha/orm";
import { describe, it } from "vitest";

import { OrmAnalyticsProvider } from "../providers/OrmAnalyticsProvider.ts";

/**
 * SQLite that refuses a statement binding more than 100 values, which is
 * what Cloudflare D1 does (`too many SQL variables`).
 *
 * Every other spec of this provider runs on Postgres, whose ceiling is
 * 65535, so none of them could see the failure Lore's hourly rollup hit on
 * D1 for a week (#Q2404): `sigil_vitals` forwarded its backlog through one
 * multi-row upsert and was refused on every run. This is also the only place
 * the fold's SQL runs on SQLite at all.
 */
class D1CeilingProvider extends NodeSqliteProvider {
  public override readonly maxBoundParameters = 100;

  protected override shimDatabaseSync(): void {
    super.shimDatabaseSync();
    const database = this.sqlite as unknown as {
      prepare: (text: string) => unknown;
    };
    const prepare = database.prepare.bind(database);
    database.prepare = (text: string) => {
      const bound = text.split("?").length - 1;
      if (bound > this.maxBoundParameters) {
        throw new Error(`too many SQL variables (${bound})`);
      }
      return prepare(text);
    };
  }
}

/**
 * Lore's `sigil_vitals`, shape for shape: a uuid index, two strings and a
 * numeric histogram bucket. Six values a row with the time bucket, so a
 * statement holds sixteen rows under D1's ceiling.
 */
const vitals = {
  name: "d1_vitals",
  index: "sigilId",
  dimensions: z.object({
    sigilId: z.uuid(),
    metric: z.string(),
    path: z.string(),
    bucket: z.number(),
  }),
  measures: z.object({ samples: z.number() }),
  slots: {
    dimensions: ["bucket", "metric", "path", "sigilId"],
    measures: ["samples"],
  },
};

const SIGIL = "00000000-0000-4000-8000-000000000001";

describe("OrmAnalyticsProvider on D1", () => {
  const boot = async () => {
    const alepha = Alepha.create().with({
      provide: DatabaseProvider,
      use: D1CeilingProvider,
    });
    alepha.store.mut(nodeSqliteOptions, (old) => ({
      ...old,
      path: "sqlite://:memory:",
    }));
    const provider = alepha.inject(OrmAnalyticsProvider);
    provider.register(vitals);
    await alepha.start();
    return { alepha, provider };
  };

  // Two days of hourly rows, five paths and seven buckets an hour: 1,680
  // rows, a hundred and five statements of sixteen. One statement would bind
  // 10,080 values.
  const backlog = () => {
    const rows = [];
    for (const day of ["2026-08-10", "2026-08-11"]) {
      for (let hour = 0; hour < 24; hour++) {
        for (let p = 0; p < 5; p++) {
          for (let bucket = 0; bucket < 7; bucket++) {
            rows.push({
              hour: `${day}T${String(hour).padStart(2, "0")}`,
              sigilId: SIGIL,
              metric: "lcp",
              path: `/p${p}`,
              bucket,
              samples: 1,
            });
          }
        }
      }
    }
    return rows;
  };

  it("records a backlog wider than one statement may bind", async ({
    expect,
  }) => {
    const { alepha, provider } = await boot();
    try {
      await provider.record(vitals, backlog());

      const result = await provider.query(vitals, {
        since: "2026-08-10",
        select: { samples: "sum" },
      });
      expect(result.rows).toEqual([{ samples: 1680 }]);
    } finally {
      await alepha.stop();
    }
  });

  it("folds it into days in the database, and keeps every sample", async ({
    expect,
  }) => {
    const { alepha, provider } = await boot();
    try {
      await provider.record(vitals, backlog());

      await provider.rollup(vitals, "2026-08-12");

      // Every hour folded into its day: 2 days x 5 paths x 7 buckets.
      const byDay = await provider.query(vitals, {
        since: "2026-08-10",
        groupBy: ["hour", "path", "bucket"],
        select: { samples: "sum" },
      });
      expect(byDay.rows).toHaveLength(70);
      expect(byDay.rows.every((row) => String(row.hour).length === 10)).toBe(
        true,
      );
      expect(byDay.rows.every((row) => row.samples === 24)).toBe(true);
      // The numeric dimension survives the fold as a number, not "3".
      expect(byDay.rows.map((row) => typeof row.bucket)).not.toContain(
        "string",
      );
    } finally {
      await alepha.stop();
    }
  });

  it("adds a second fold onto the day it already holds", async ({ expect }) => {
    const { alepha, provider } = await boot();
    try {
      const rows = backlog().filter((row) => row.hour.startsWith("2026-08-10"));
      await provider.record(vitals, rows);
      await provider.rollup(vitals, "2026-08-11");
      // A late row for a day already folded, the way a forward can land one.
      await provider.record(vitals, [{ ...rows[0], samples: 5 }]);
      await provider.rollup(vitals, "2026-08-11");

      const result = await provider.query(vitals, {
        since: "2026-08-10",
        where: { path: "/p0", bucket: 0 },
        select: { samples: "sum" },
      });
      expect(result.rows).toEqual([{ samples: 24 + 5 }]);
    } finally {
      await alepha.stop();
    }
  });
});
