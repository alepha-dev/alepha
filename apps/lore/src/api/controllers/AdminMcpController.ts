import { $inject, z } from "alepha";
import { AnalyticsBuckets } from "alepha/api/analytics";
import { DateTimeProvider } from "alepha/datetime";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";
import { $etag } from "alepha/server/etag";

import { LoreAnalytics } from "../entities/loreAnalytics.ts";

/**
 * What the MCP surface is actually asked for, over time (#E65).
 *
 * ## The question this answers, and why nothing answered it before
 *
 * MCP is Lore's primary consumer, and a tool call leaves no row in any entity
 * table. A write eventually surfaces as an audit row (`quest_update` becomes
 * `quest:update`), but a read does not, and reads are most of the traffic. So
 * "which tools do agents call, and which of them refuse" was unanswerable
 * anywhere in this app until `mcp_calls` existed. That is the whole point of
 * this controller: it is the chart that could not be drawn before the store.
 *
 * ## Admin, not a project page
 *
 * A tool call is not scoped to a project - `project_list` has none, and every
 * other tool names one in its own arguments under its own key, so the
 * dataset deliberately carries no `project` dimension. The audience is
 * whoever maintains the tool descriptions, which is an operator.
 *
 * Gated on `admin:analytics:read`, the permission the framework's own
 * analytics admin surface already declares: this is a second view of the
 * same kind of data and inventing a permission for it would mean an admin
 * holding one and not the other for no reason anybody could state.
 *
 * ## ⚠️ The read leaves the process
 *
 * Answered by Analytics Engine on production. Unlike Home, an admin page
 * that fails to load is not an outage, so this does NOT swallow the failure:
 * the page shows the request's own error. The rule the two follow is the
 * same one - the landing page must render without its strip - and it simply
 * does not reach here.
 */
export class AdminMcpController {
  /**
   * How many days the chart draws.
   *
   * Thirty is the dataset's hot window, so every bucket in range is still at
   * hour precision underneath and the daily fold is exact rather than a fold
   * of a fold.
   */
  protected static readonly WINDOW_DAYS = 30;

  /**
   * How many tools the timeline draws as their own series.
   *
   * Beyond a handful a stacked chart stops being readable, and the table
   * below it carries the full list anyway. Lore registers around sixty tools
   * across twelve classes, so this is a leaderboard cut, not a cap on what is
   * measured.
   */
  protected static readonly TOP_TOOLS = 8;

  protected readonly url = "/admin/mcp";
  protected readonly group = "admin:mcp";
  protected readonly datasets = $inject(LoreAnalytics);
  protected readonly dt = $inject(DateTimeProvider);

  public readonly readMcpCalls = $action({
    path: `${this.url}/calls`,
    group: this.group,
    use: [
      // Five minutes, and `private` like every other authenticated read: the
      // answer is instance-wide rather than per viewer, but the edge cache
      // keys a public response by URL alone and this one is behind a
      // permission.
      $etag({ control: { private: true, maxAge: 300 } }),
      $secure({ permissions: ["admin:analytics:read"] }),
    ],
    description: "MCP tool calls per day, by tool and by outcome",
    schema: {
      response: z.object({
        /**
         * The days the series are indexed by, oldest first, `YYYY-MM-DD`.
         * Sent rather than derived on the client so the bars cannot drift
         * from the buckets the dataset grouped.
         */
        days: z.array(z.text()),
        /**
         * The busiest tools, most-called first, each with one count per entry
         * of {@link days}.
         */
        tools: z.array(
          z.object({
            tool: z.text(),
            counts: z.array(z.integer()),
            total: z.integer(),
          }),
        ),
        /**
         * Every tool that was called at all, most-called first, with how its
         * calls ended. The chart draws the busiest few; this is the list.
         */
        leaderboard: z.array(
          z.object({
            tool: z.text(),
            total: z.integer(),
            ok: z.integer(),
            refused: z.integer(),
            errors: z.integer(),
          }),
        ),
        /**
         * Whether the numbers are reconstructed rather than measured, and at
         * what interval.
         *
         * Surfaced here, unlike Home's fourteen bars: this page is read by
         * whoever is deciding whether a tool's refusal rate is real, and a
         * sampled number they cannot tell from an exact one is worse than no
         * number.
         */
        estimated: z.boolean(),
        sampleInterval: z.integer().optional(),
      }),
    },
    handler: async () => {
      const days = this.windowDays();
      const since = days[0];

      const [byDay, byOutcome] = await Promise.all([
        this.datasets.mcpCalls.query({
          since,
          groupBy: ["day", "tool"],
          select: { count: "sum" },
        }),
        this.datasets.mcpCalls.query({
          since,
          groupBy: ["tool", "outcome"],
          select: { count: "sum" },
        }),
      ]);

      const leaderboard = this.leaderboard(byOutcome.rows);
      const tools = this.series(
        byDay.rows,
        days,
        leaderboard
          .slice(0, AdminMcpController.TOP_TOOLS)
          .map((row) => row.tool),
      );

      return {
        days,
        tools,
        leaderboard,
        estimated: byDay.estimated || byOutcome.estimated,
        sampleInterval: Math.max(
          byDay.sampleInterval ?? 1,
          byOutcome.sampleInterval ?? 1,
        ),
      };
    },
  });

  /**
   * One row per tool, with its calls split by how they ended, busiest first.
   */
  protected leaderboard(rows: Array<Record<string, string | number>>): Array<{
    tool: string;
    total: number;
    ok: number;
    refused: number;
    errors: number;
  }> {
    const byTool = new Map<
      string,
      {
        tool: string;
        total: number;
        ok: number;
        refused: number;
        errors: number;
      }
    >();
    for (const row of rows) {
      const tool = String(row.tool);
      const entry = byTool.get(tool) ?? {
        tool,
        total: 0,
        ok: 0,
        refused: 0,
        errors: 0,
      };
      const count = Number(row.count) || 0;
      entry.total += count;
      // An outcome the dataset does not know about is counted in the total
      // and nowhere else, rather than folded into one of the three: a new
      // value added later should read as unclassified, not as a fault.
      if (row.outcome === "ok") entry.ok += count;
      else if (row.outcome === "refused") entry.refused += count;
      else if (row.outcome === "error") entry.errors += count;
      byTool.set(tool, entry);
    }
    return [...byTool.values()].sort((a, b) => b.total - a.total);
  }

  /**
   * One zero-filled series per named tool, in the order they were named.
   */
  protected series(
    rows: Array<Record<string, string | number>>,
    days: string[],
    tools: string[],
  ): Array<{ tool: string; counts: number[]; total: number }> {
    const index = new Map(days.map((label, position) => [label, position]));
    const byTool = new Map<string, number[]>(
      tools.map((tool) => [tool, days.map(() => 0)]),
    );

    for (const row of rows) {
      const counts = byTool.get(String(row.tool));
      const position = index.get(String(row.day));
      // A bucket outside the labels is a boundary case, not an error: the
      // window is asked for by day and the labels come from the clock, so
      // the two can disagree by one at the edge.
      if (counts && position !== undefined) {
        counts[position] += Number(row.count) || 0;
      }
    }

    return tools.map((tool) => {
      const counts = byTool.get(tool) ?? days.map(() => 0);
      return {
        tool,
        counts,
        total: counts.reduce((sum, count) => sum + count, 0),
      };
    });
  }

  /**
   * The window's day labels, oldest first, in UTC.
   *
   * UTC because the dataset's `day` pseudo-dimension is the prefix of a UTC
   * hour bucket, and a label generated in another zone would name a bucket
   * the store never produced. Read through `DateTimeProvider`, so a test that
   * travels sees the window move with it.
   */
  protected windowDays(): string[] {
    const today = this.dt.nowMillis();
    const dayMs = 24 * 60 * 60 * 1000;
    const labels: string[] = [];
    for (let back = AdminMcpController.WINDOW_DAYS - 1; back >= 0; back--) {
      labels.push(
        AnalyticsBuckets.day(AnalyticsBuckets.hour(today - back * dayMs)),
      );
    }
    return labels;
  }
}
