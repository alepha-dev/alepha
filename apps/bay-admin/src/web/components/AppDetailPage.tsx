import { Badge } from "@alepha/ui/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { useClient } from "alepha/react";
import { useRouter } from "alepha/react/router";
import { useEffect, useState } from "react";
import type { AppDetailController } from "../../api/controllers/AppDetailController.ts";

export interface AppDetailPageProps {
  slug: string;
  tab: string;
  overview: {
    slug: string;
    name: string;
    kind: string;
    status: string;
    release?: string;
    lastSeenAt?: string;
    uptimeSec?: number;
    errors24h: number;
    groups: number;
  };
}

const TABS = ["overview", "errors", "analytics", "metrics"] as const;

/**
 * One app, four views.
 *
 * The overview loads with the page; the other tabs fetch on demand. An app in
 * trouble is one whose error list is being reloaded constantly, and making that
 * wait on a metrics scan would make the page slowest exactly when it matters.
 */
const AppDetailPage = (props: AppDetailPageProps) => {
  const router = useRouter();
  const api = useClient<AppDetailController>();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{props.overview.name}</h1>
        <StatusBadge status={props.overview.status} />
        <Badge variant="secondary">{props.overview.kind}</Badge>
        {props.overview.release && (
          <span className="text-muted-foreground font-mono text-xs">
            {props.overview.release}
          </span>
        )}
      </div>

      <div className="flex gap-1 border-b">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={`px-3 py-2 text-sm capitalize ${
              props.tab === tab
                ? "border-primary text-foreground border-b-2 font-medium"
                : "text-muted-foreground"
            }`}
            onClick={() =>
              void router.push("app", {
                params: { slug: props.slug },
                query: { tab },
              })
            }
          >
            {tab}
          </button>
        ))}
      </div>

      {props.tab === "overview" && <Overview overview={props.overview} />}
      {props.tab === "errors" && <Errors slug={props.slug} api={api} />}
      {props.tab === "analytics" && <Analytics slug={props.slug} api={api} />}
      {props.tab === "metrics" && <Metrics slug={props.slug} api={api} />}
    </div>
  );
};

export default AppDetailPage;

/**
 * Only the abnormal states are coloured.
 *
 * A green badge on every healthy app trains the eye to skip the row, which is
 * the opposite of what a status is for.
 */
const StatusBadge = (props: { status: string }) => {
  if (props.status === "up") {
    return <Badge variant="secondary">up</Badge>;
  }
  if (props.status === "stopped") {
    return <Badge variant="outline">stopped</Badge>;
  }
  return <Badge variant="destructive">{props.status}</Badge>;
};

const Overview = (props: { overview: AppDetailPageProps["overview"] }) => (
  <div className="grid gap-4 sm:grid-cols-3">
    <Stat
      label="Errors, 24h"
      value={String(props.overview.errors24h)}
      hint={`${props.overview.groups} distinct`}
    />
    <Stat
      label="Uptime"
      value={
        props.overview.uptimeSec
          ? `${Math.round(props.overview.uptimeSec / 3600)}h`
          : "—"
      }
    />
    <Stat
      label="Last seen"
      value={
        props.overview.lastSeenAt
          ? new Date(props.overview.lastSeenAt).toLocaleTimeString()
          : "never"
      }
    />
  </div>
);

const Stat = (props: { label: string; value: string; hint?: string }) => (
  <Card>
    <CardHeader>
      <CardDescription>{props.label}</CardDescription>
      <CardTitle className="text-2xl">{props.value}</CardTitle>
    </CardHeader>
    {props.hint && (
      <CardContent>
        <span className="text-muted-foreground text-xs">{props.hint}</span>
      </CardContent>
    )}
  </Card>
);

const Errors = (props: { slug: string; api: any }) => {
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    void props.api
      .errorList({ params: { slug: props.slug } })
      .then(setRows)
      .catch(() => setRows([]));
  }, [props.api, props.slug]);

  if (!rows.length) {
    return <Empty>No errors reported.</Empty>;
  }

  return (
    <Card className="divide-y gap-0 py-0">
      {rows.map((row) => (
        <CardContent key={row.fingerprint} className="flex flex-col gap-1 py-3">
          <div className="flex flex-wrap items-center gap-2">
            {/*
              Rendered as escaped text, never markdown: name and message come
              from an app's runtime, which handles input from the public.
            */}
            <span className="font-medium">{row.name}</span>
            <Badge variant="secondary">×{row.count}</Badge>
            {row.release && (
              <span className="text-muted-foreground font-mono text-xs">
                {row.release}
              </span>
            )}
          </div>
          <span className="text-muted-foreground truncate text-sm">
            {row.message}
          </span>
          <span className="text-muted-foreground text-xs">
            {new Date(row.firstSeenAt).toLocaleString()} →{" "}
            {new Date(row.lastSeenAt).toLocaleString()}
          </span>
        </CardContent>
      ))}
    </Card>
  );
};

const Analytics = (props: { slug: string; api: any }) => {
  const [data, setData] = useState<any>();

  useEffect(() => {
    void props.api
      .analytics({ params: { slug: props.slug }, query: { days: 7 } })
      .then(setData)
      .catch(() => setData(undefined));
  }, [props.api, props.slug]);

  if (!data) {
    return <Empty>No traffic recorded.</Empty>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Stat label="Views, 7d" value={String(data.views)} />
        <Stat
          label="Unique visitors, 7d"
          value={String(data.uniques)}
          // Said here rather than in a tooltip nobody opens: the number is a
          // floor, and treating it as a headcount is the mistake to prevent.
          hint="cookieless, daily — a floor, not a headcount"
        />
      </div>
      <Card className="divide-y gap-0 py-0">
        {data.topPaths.map((row: any) => (
          <CardContent
            key={row.path}
            className="flex items-center justify-between py-2"
          >
            <span className="truncate font-mono text-sm">{row.path}</span>
            <span className="text-muted-foreground text-sm">{row.count}</span>
          </CardContent>
        ))}
      </Card>
    </div>
  );
};

const SERIES = [
  "rss",
  "heapUsed",
  "eventLoopDelayP95",
  "reqCount",
  "reqDurationP95",
] as const;

const Metrics = (props: { slug: string; api: any }) => {
  const [series, setSeries] = useState<string>("rss");
  const [points, setPoints] = useState<any[]>([]);

  useEffect(() => {
    void props.api
      .metricSeries({
        params: { slug: props.slug },
        query: { series, hours: 6 },
      })
      .then(setPoints)
      .catch(() => setPoints([]));
  }, [props.api, props.slug, series]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {SERIES.map((name) => (
          <button
            key={name}
            type="button"
            className={`rounded border px-2 py-1 font-mono text-xs ${
              series === name ? "bg-muted font-medium" : "text-muted-foreground"
            }`}
            onClick={() => setSeries(name)}
          >
            {name}
          </button>
        ))}
      </div>
      {points.length === 0 ? (
        <Empty>No samples in the last 6 hours.</Empty>
      ) : (
        <Card>
          <CardContent className="py-4">
            <Sparkline points={points.map((p) => p.value)} />
            <div className="text-muted-foreground mt-2 flex justify-between text-xs">
              <span>{new Date(points[0].at).toLocaleTimeString()}</span>
              <span>
                {new Date(points[points.length - 1].at).toLocaleTimeString()}
              </span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

/**
 * A plain inline sparkline.
 *
 * A charting library for one line would be the largest dependency in this app,
 * and the shape around an incident is all anyone reads here.
 */
const Sparkline = (props: { points: number[] }) => {
  const max = Math.max(...props.points, 1);
  const min = Math.min(...props.points, 0);
  const span = max - min || 1;
  const path = props.points
    .map((value, index) => {
      const x = (index / Math.max(props.points.length - 1, 1)) * 100;
      const y = 40 - ((value - min) / span) * 40;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      className="h-24 w-full"
    >
      <title>Metric over time</title>
      <path d={path} fill="none" stroke="currentColor" strokeWidth="0.8" />
    </svg>
  );
};

const Empty = (props: { children: React.ReactNode }) => (
  <Card>
    <CardHeader>
      <CardDescription>{props.children}</CardDescription>
    </CardHeader>
  </Card>
);
