import type {
  AdminAnalyticsQuery,
  AdminAnalyticsResult,
  AdminDatasetDescriptor,
} from "alepha/api/analytics";

/**
 * One declared dataset and a generator that answers any query against it.
 *
 * ⚠️ `dimensions` and `measures` are JSON Schema objects on the wire, not zod
 * schemas: the admin explorer rebuilds form schemas from them with
 * `jsonSchemaToZod`. Handing it a zod schema here produces a control panel with
 * no controls.
 *
 * The rows are COMPUTED from the query rather than canned, because the explorer
 * lets a reader change the grouping, the window and the measures. A fixed row
 * set would answer every question with the same table, which is worse than an
 * empty one: it looks like the controls do nothing.
 */
export class ShowcaseAnalytics {
  public datasets(): AdminDatasetDescriptor[] {
    return [
      {
        name: "pageviews",
        index: "showcase_pageviews",
        dimensions: {
          type: "object",
          properties: {
            path: { type: "string", title: "Path" },
            country: { type: "string", title: "Country" },
            device: { type: "string", title: "Device" },
          },
        },
        measures: {
          type: "object",
          properties: {
            views: { type: "number", title: "Views" },
            visitors: { type: "number", title: "Visitors" },
          },
        },
        folds: { views: ["sum"], visitors: ["sum"] },
        resolution: "1h",
        retention: [
          { resolution: "1h", keep: "30d" },
          { resolution: "1d", keep: "1825d" },
        ],
      },
      {
        name: "device_metrics",
        index: "deviceId",
        dimensions: {
          type: "object",
          properties: {
            deviceId: { type: "string", title: "Device" },
            line: { type: "string", title: "Line" },
          },
        },
        measures: {
          type: "object",
          properties: {
            validations: { type: "number", title: "Validations" },
            temperature: { type: "number", title: "Temperature" },
          },
        },
        folds: {
          validations: ["sum"],
          temperature: ["min", "max", "last"],
        },
        resolution: "1m",
        retention: [
          { resolution: "1m", keep: "48h" },
          { resolution: "1h", keep: "30d" },
          { resolution: "1d", keep: "400d" },
        ],
      },
    ];
  }

  /**
   * Answers by cross-producting the requested `groupBy` values and summing a
   * deterministic pseudo-random measure. Deterministic on purpose: a moving
   * dataset would make every prerender differ and leave the e2e suite nothing
   * stable to assert.
   */
  public query(query: AdminAnalyticsQuery): AdminAnalyticsResult {
    const groupBy = query.groupBy ?? [];
    // One key per measure, or `<measure>_<fold>` per fold of an array select,
    // as the real service answers.
    const keys = Object.entries(query.select ?? {}).flatMap(
      ([measure, folds]) =>
        Array.isArray(folds)
          ? folds.map((fold) => ({ key: `${measure}_${fold}`, fold }))
          : [{ key: measure, fold: folds }],
    );
    const limit = query.limit ?? 50;

    const values: Record<string, string[]> = {
      path: ["/", "/blocks/select", "/blocks/table", "/blocks/controls"],
      country: ["FR", "GB", "US", "NL"],
      device: ["desktop", "mobile", "tablet"],
      deviceId: ["tvm-001", "tvm-002", "tvm-003", "tvm-004", "tvm-005"],
      line: ["L1", "L2"],
      day: ["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"],
      hour: Array.from(
        { length: 12 },
        (_, i) => `2026-10-17T${String(i + 8).padStart(2, "0")}`,
      ),
      minute: Array.from(
        { length: 15 },
        (_, i) => `2026-10-17T10:${String(i).padStart(2, "0")}`,
      ),
    };

    let combos: Record<string, string>[] = [{}];
    for (const key of groupBy) {
      const options = values[key] ?? ["unknown"];
      combos = combos.flatMap((base) =>
        options.map((v) => ({ ...base, [key]: v })),
      );
    }

    const rows = combos.slice(0, limit).map((combo, i) => {
      const row: Record<string, string | number> = { ...combo };
      for (const [m, { key, fold }] of keys.entries()) {
        // A gauge reads as a temperature: min, then last, then max, apart.
        const base = 18 + (this.pseudo(i, 0) % 8);
        row[key] =
          fold === "min"
            ? base
            : fold === "max"
              ? base + 6
              : fold === "last"
                ? base + 3
                : this.pseudo(i, m);
      }
      return row;
    });

    if (query.orderBy) {
      const { key, direction } = query.orderBy;
      rows.sort((a, b) => {
        const left = a[key];
        const right = b[key];
        const cmp =
          typeof left === "number" && typeof right === "number"
            ? left - right
            : String(left).localeCompare(String(right));
        return direction === "desc" ? -cmp : cmp;
      });
    }

    return {
      rows,
      // Honest about not being a sample: the real service sets this when it
      // had to estimate, and a fixture claiming estimation would misrepresent
      // what the field means.
      estimated: false,
    };
  }

  /**
   * A stable, spread-out integer. Not `Math.random`: the numbers have to be
   * the same on every render and every build.
   */
  protected pseudo(row: number, measure: number): number {
    const seed = (row + 1) * 2654435761 + (measure + 1) * 40503;
    return 40 + (Math.abs(seed >> 7) % 4200);
  }
}
