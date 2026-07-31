import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@alepha/ui/components/ui/chart";
import { Eye, Globe, Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

const viewsConfig = {
  count: { label: "Views", color: "var(--chart-1)" },
} satisfies ChartConfig;

export interface AnalyticsViewProps {
  views: number;
  uniques: number;
  timeline: Array<{ day: string; count: number }>;
  topPaths: Array<{ path: string; count: number }>;
  topCountries: Array<{ country: string; count: number }>;
}

/**
 * Traffic: how many people, how many pages, from where.
 *
 * Unique visitors is the trustworthy number and views is not — the ingest
 * endpoint has no per-IP cap, so the raw count is inflatable while the visitor
 * hash is salted per day and per host. Said on the card rather than left for
 * someone to discover.
 */
const AnalyticsView = (props: AnalyticsViewProps) => (
  <div className="flex flex-col gap-4">
    <div className="grid gap-4 sm:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
            <Users className="size-4" />
            Unique visitors
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-semibold tabular-nums">
            {props.uniques.toLocaleString()}
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            Cookieless — a daily hash salted with the site's own host.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
            <Eye className="size-4" />
            Page views
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-semibold tabular-nums">
            {props.views.toLocaleString()}
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            Best-effort: nothing rate-limits the endpoint, so this is
            inflatable.
          </p>
        </CardContent>
      </Card>
    </div>

    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Views over time</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={viewsConfig} className="h-56 w-full">
          <BarChart data={props.timeline}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={false}
              tickFormatter={(day: string) => day.slice(5)}
            />
            <YAxis tickLine={false} axisLine={false} width={32} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="count" fill="var(--color-count)" radius={2} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>

    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Top pages</CardTitle>
        </CardHeader>
        <CardContent>
          <RankedList
            rows={props.topPaths.map((p) => ({
              label: p.path,
              count: p.count,
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Globe className="size-4" />
            Top countries
          </CardTitle>
        </CardHeader>
        <CardContent>
          <RankedList
            rows={props.topCountries.map((c) => ({
              label: `${flagEmoji(c.country)} ${c.country}`,
              count: c.count,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  </div>
);

/**
 * A list with a proportional bar behind each row.
 *
 * Proportional to the LARGEST row, not to the total: the question this answers
 * is "what dominates", and a long tail would flatten every bar to nothing if
 * scaled against the sum.
 */
const RankedList = (props: {
  rows: Array<{ label: string; count: number }>;
}) => {
  if (props.rows.length === 0) {
    return <p className="text-muted-foreground text-sm">No data yet.</p>;
  }
  const max = Math.max(...props.rows.map((r) => r.count), 1);

  return (
    <div className="flex flex-col gap-1">
      {props.rows.map((row) => (
        <div key={row.label} className="relative flex items-center gap-2 py-1">
          <div
            className="bg-primary/10 absolute inset-y-0 left-0 rounded"
            style={{ width: `${(row.count / max) * 100}%` }}
          />
          <span className="relative truncate text-sm">{row.label}</span>
          <span className="text-muted-foreground relative ml-auto text-sm tabular-nums">
            {row.count.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
};

/**
 * ISO-3166 alpha-2 to its flag, by offsetting into the regional-indicator
 * block. `ZZ` — what the edge reports when it cannot tell — has no flag, and a
 * globe is more honest than a pair of Z indicators.
 */
const flagEmoji = (code: string): string => {
  if (code === "ZZ" || code.length !== 2) return "🌐";
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => 0x1f1e6 - 65 + c.charCodeAt(0)),
  );
};

export default AnalyticsView;
