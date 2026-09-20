import { Badge, Card, CardContent } from "@alepha/ui";
import { AdminPage } from "@alepha/ui/admin";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@alepha/ui/chart";
import { useClient, useQuery } from "alepha/react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import type { AdminMcpController } from "@/api/controllers/AdminMcpController.ts";

/**
 * What the MCP surface is asked for, over thirty days (#E65).
 *
 * ## The chart that could not be drawn before this epic
 *
 * MCP is Lore's primary consumer and a tool call leaves no row in any entity
 * table. A write eventually appears in the audit log; a read does not, and
 * reads are most of the traffic. So until `mcp_calls` existed, "which tools
 * do agents actually call" had no answer in any surface of this app - not a
 * partial one, not a slow one, none. That is what makes it the honest test of
 * the premise this epic rested on: the store is worth more than a daily
 * counts table in D1 only if a family of event-rate charts exists, and a
 * counts table could not have served this one either, because nothing was
 * ever stored to count.
 *
 * ## Two halves, and the second is the useful one
 *
 * The timeline says how much. The table says how those calls ENDED, and that
 * is what a tool's author acts on: a tool called constantly that refuses half
 * its calls has a description or a schema that misleads the model, and a tool
 * that ERRORS is simply broken. A single "failures" number would say neither,
 * which is why the dataset keeps `refused` and `error` apart.
 *
 * ## ⚠️ `estimated` is surfaced here
 *
 * Unlike Home's fourteen bars, where the decision was not to. This page is
 * read by somebody deciding whether a refusal rate is real, and a sampled
 * number they cannot tell from an exact one is worse than no number at all.
 *
 * Literal English, like every other page in the Lore admin: this shell is
 * untranslated.
 */
export const AdminMcp = () => {
  const client = useClient<AdminMcpController>();

  const { data, loading } = useQuery(
    {
      key: ["admin-mcp-calls"],
      handler: () => client.readMcpCalls(),
    },
    [client],
  );

  const days = data?.days ?? [];
  const tools = data?.tools ?? [];
  const leaderboard = data?.leaderboard ?? [];

  /**
   * One series per busy tool, each its own colour from the theme's chart
   * ramp. Eight is what the endpoint sends and what `--chart-1..8` offers, so
   * the two agree by construction rather than by a modulo nobody would notice
   * going wrong.
   */
  const config = Object.fromEntries(
    tools.map((series, index) => [
      series.tool,
      { label: series.tool, color: `var(--chart-${index + 1})` },
    ]),
  ) satisfies ChartConfig;

  /**
   * Recharts wants one object per x value with a key per series, and the
   * endpoint sends one series per tool. Transposed here rather than on the
   * server, because the wire shape is the one a table and a chart both read.
   */
  const points = days.map((day, index) => ({
    day,
    ...Object.fromEntries(
      tools.map((series) => [series.tool, series.counts[index] ?? 0]),
    ),
  }));

  const total = leaderboard.reduce((sum, row) => sum + row.total, 0);

  return (
    <AdminPage className="p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">MCP tool calls</h1>
          <p className="text-muted-foreground text-sm">
            Every `tools/call` this instance served over the last 30 days, by
            tool. Reads leave no other trace anywhere in Lore.
          </p>
        </div>
        {data?.estimated && (
          <span className="text-muted-foreground text-xs">
            {data.sampleInterval && data.sampleInterval > 1
              ? `Estimated from a 1-in-${data.sampleInterval} sample`
              : "Exact (no sampling at this volume)"}
          </span>
        )}
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums">{total}</span>
            <span className="text-muted-foreground text-sm">
              calls over {days.length} days
            </span>
          </div>

          {tools.length > 0 ? (
            <ChartContainer
              config={config}
              className="aspect-auto h-[260px] w-full"
            >
              <BarChart data={points}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="day"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={24}
                />
                <YAxis tickLine={false} axisLine={false} width={40} />
                <ChartTooltip content={<ChartTooltipContent />} />
                {tools.map((series) => (
                  <Bar
                    key={series.tool}
                    dataKey={series.tool}
                    stackId="calls"
                    fill={`var(--color-${series.tool})`}
                  />
                ))}
              </BarChart>
            </ChartContainer>
          ) : (
            <p className="text-muted-foreground py-10 text-center text-sm">
              {loading
                ? "Reading…"
                : "No tool call has been recorded yet. Recording started with the deploy that added this page, so the window fills in from there."}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Every tool called</h2>
          {leaderboard.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              Nothing yet.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-xs">
                <tr className="border-b">
                  <th className="py-1 text-left font-medium">Tool</th>
                  <th className="py-1 text-right font-medium">Calls</th>
                  <th className="py-1 text-right font-medium">OK</th>
                  <th className="py-1 text-right font-medium">Refused</th>
                  <th className="py-1 text-right font-medium">Errors</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((row) => (
                  <tr key={row.tool} className="border-b last:border-0">
                    <td className="py-1 font-mono text-xs">{row.tool}</td>
                    <td className="py-1 text-right tabular-nums">
                      {row.total}
                    </td>
                    <td className="py-1 text-right tabular-nums">{row.ok}</td>
                    <td className="py-1 text-right tabular-nums">
                      {/* A refusal is the API working: the agent asked for
                          something it may not have, or malformed. Worth
                          seeing, never red. */}
                      {row.refused > 0 ? (
                        <Badge variant="secondary">{row.refused}</Badge>
                      ) : (
                        row.refused
                      )}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {row.errors > 0 ? (
                        <Badge variant="destructive">{row.errors}</Badge>
                      ) : (
                        row.errors
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </AdminPage>
  );
};

export default AdminMcp;
