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
        retention: { hot: "30d", rollup: "1y", cold: "5y" },
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
    const measures = Object.keys(query.select ?? {});
    const limit = query.limit ?? 50;

    const values: Record<string, string[]> = {
      path: ["/", "/blocks/select", "/blocks/table", "/blocks/controls"],
      country: ["FR", "GB", "US", "NL"],
      device: ["desktop", "mobile", "tablet"],
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
      for (const [m, measure] of measures.entries()) {
        row[measure] = this.pseudo(i, m);
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
