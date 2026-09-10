import { Button } from "@alepha/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@alepha/ui/components/ui/chart";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { Bug, Inbox, Laptop, Server } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import type { AppRouter } from "../../../AppRouter.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import AppErrorsStat from "./AppErrorsStat.tsx";
import AppInsightsControls from "./AppInsightsControls.tsx";
import { useAppInsights } from "./useAppInsights.ts";

/**
 * The error budget of THIS app: how many failures over the window, split by
 * where they were raised, and which distinct ones are the worst.
 *
 * ## Why this is a tab and not a card on Analytics
 *
 * It was a card on Analytics, added by #1215 when three tiles left the app
 * Dashboard so that page would issue no analytics query at all. The owner
 * asked for it off that page (feedback #2080, "remove Blights Card on
 * Analytics page, it's not the right place"), and they are right: an error
 * budget is not a traffic number.
 *
 * Deleting it was the other candidate and is what #178 did to the App ▸ Errors
 * tab this restores. #178's reasoning was that at ONE enrolled app the tab
 * duplicated the Blights inbox - and it recorded that "the distinction returns
 * at two". It has: the report came from a second app. The inbox keys on
 * `(project, fingerprint)` so a triage decision does not fork, which merges
 * every enrolled app into one row and makes it structurally unable to answer
 * "is this still happening in that app".
 *
 * The Dashboard was the third candidate and is the one that cannot work
 * cheaply: `errorGroups` is a field of the whole insights payload, not an
 * endpoint of its own, so putting it there would make the Dashboard pay the
 * full analytics query - exactly what #1215 removed, and what
 * `AppDashboard.browser.spec.tsx` guards.
 *
 * ## Stats, not a list (feedback #2085)
 *
 * The report asked for this tab to be "for stats, not just a list", because
 * the list already lives in the Blights inbox. It leads with the chart, and
 * the chart is fed by the `sigil_errors` analytics dataset rather than by
 * `errorGroups`.
 *
 * ⚠️ That distinction is the whole design. `sigil_error_groups` holds ONE row
 * per `(sigilId, fingerprint)` with a running ALL-TIME count and is read
 * filtered on `lastSeenAt`, so plotting it would draw lifetime totals against
 * a window - wrong in a way no reader could detect. `errorSeries` is the
 * number that respects the window; `errorGroups[].count` is not, which is why
 * the list below says so out loud rather than letting the column read as the
 * window's.
 *
 * ⚠️ `name` and `message` come out of the reporting application's runtime and
 * are attacker-controlled, shown to the project owner. Escaped plain text
 * only - never markdown, never `dangerouslySetInnerHTML`.
 */
const AppErrors = () => {
  const { tr, l } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const [project] = useStore(currentProjectAtom);
  const { data, loading, range, traffic, setFilters } = useAppInsights();

  const groups = data?.errorGroups ?? [];
  const series = (data?.errorSeries ?? []).map((point) => ({
    date: point.date.slice(5),
    client: point.client,
    server: point.server,
  }));

  const totals = series.reduce(
    (acc, point) => ({
      client: acc.client + point.client,
      server: acc.server + point.server,
    }),
    { client: 0, server: 0 },
  );
  const total = totals.client + totals.server;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Bug className="size-4" />
          <span>{tr("insights.errors.title")}</span>
          <span className="text-xs">· {tr("insights.errors.note")}</span>
        </div>
        <AppInsightsControls
          range={range}
          traffic={traffic}
          loading={loading}
          onChange={setFilters}
        />
      </div>

      {/* The three window numbers, above the fold and above the list. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <AppErrorsStat label={tr("insights.errors.stat.total")} value={total} />
        <AppErrorsStat
          label={tr("insights.errors.stat.client")}
          value={totals.client}
          icon={Laptop}
        />
        <AppErrorsStat
          label={tr("insights.errors.stat.server")}
          value={totals.server}
          icon={Server}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bug className="size-4" />
            {tr("insights.errors.chart.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {total > 0 ? (
            <ChartContainer
              config={errorsChartConfig}
              className="aspect-auto h-[240px] w-full"
            >
              {/* Stacked, so the bar's height is the window's total and the
                  split is readable inside it without a second chart. */}
              <BarChart data={series}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  width={40}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar
                  dataKey="client"
                  stackId="errors"
                  fill="var(--color-client)"
                />
                <Bar
                  dataKey="server"
                  stackId="errors"
                  fill="var(--color-server)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ChartContainer>
          ) : (
            <p
              className="text-muted-foreground py-8 text-center text-sm"
              data-testid="app-errors-chart-empty"
            >
              {tr("insights.errors.empty")}
            </p>
          )}
        </CardContent>
      </Card>

      {groups.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {tr("insights.errors.worst.title")}
            </CardTitle>
            {/* ⚠️ Said out loud, not implied. The count is the group's
                all-time total; the read filters on `lastSeenAt`, so a group
                last seen inside the window brings its whole history with it.
                Without this line the column reads as the window's. */}
            <p className="text-muted-foreground text-xs">
              {tr("insights.errors.worst.note")}
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-0 p-0">
            {groups.map((group) => (
              <div
                key={group.fingerprint}
                data-testid="app-error-group"
                className="border-border flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-4 py-3 last:border-b-0"
              >
                <span
                  className="text-muted-foreground shrink-0 text-xs"
                  data-testid="app-error-origin"
                >
                  {group.origin === "server"
                    ? tr("insights.errors.origin.server")
                    : tr("insights.errors.origin.client")}
                </span>
                <span className="font-medium">{group.name}</span>
                <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
                  {group.message}
                </span>
                <span className="text-sm font-semibold tabular-nums">
                  {group.count.toLocaleString()}
                </span>
                <span className="text-muted-foreground text-xs">
                  {String(l(group.lastSeenAt, { date: "lll" }))}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Triage stays in the project inbox, deliberately: a blight keys on
          `(project, fingerprint)` precisely so one decision covers every app
          that hit it. This tab answers "is it still happening here"; it does
          not offer a second place to resolve or ignore.

          A real button rather than the muted footer link it was: the report
          said the inbox link "already exists" and still asked for one, which
          is what a `text-xs` muted link in a corner earns. */}
      {project && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            render={
              <Link
                href={router.path("projectBlights", {
                  params: { projectSlug: project.slug },
                })}
              />
            }
          >
            <Inbox className="size-4" />
            {tr("insights.errors.inbox")}
          </Button>
        </div>
      )}
    </div>
  );
};

/**
 * `ChartContainer` exposes each key as a `--color-<key>` CSS variable, so the
 * bars track the theme and dark mode. Two chart slots apart, so the split is
 * legible rather than two shades of one hue.
 */
const errorsChartConfig = {
  client: { label: "Client", color: "var(--chart-1)" },
  server: { label: "Server", color: "var(--chart-3)" },
} satisfies ChartConfig;

export default AppErrors;
