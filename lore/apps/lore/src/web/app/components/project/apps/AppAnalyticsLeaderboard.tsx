import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@alepha/ui/components/ui/tabs";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { useState } from "react";

import type { InsightsDimensionResource } from "@/api/schemas/insightsDimensionResourceSchema.ts";

import type { I18n } from "../../../services/I18n.ts";

export interface AppAnalyticsLeaderboardRow {
  /**
   * The stored value, which is what a filter is set to.
   */
  value: string;
  /**
   * What the row reads as, which is not always the value: `direct` and `none`
   * are sentinel buckets with names of their own, and a country is a code the
   * reader should not have to decode.
   */
  label: string;
  count: number;
  percentage: number;
}

export interface AppAnalyticsLeaderboardSegment {
  dimension: InsightsDimensionResource["dimension"];
  title: string;
  /**
   * The caveat that makes the numbers readable, when there is one.
   *
   * Three of the six segments have one and it is not decoration: entry paths
   * and campaigns are counted on arrivals rather than views, and `direct` is a
   * denominator rather than a source. A reader without those sentences will
   * compare the wrong things.
   */
  note?: string;
  rows: AppAnalyticsLeaderboardRow[];
  /**
   * Where the "More" link goes for this segment.
   */
  href: string;
}

export interface AppAnalyticsLeaderboardProps {
  testId: string;
  /**
   * One or two segments. Two render as tabs inside one card, which is what
   * buys the density: six leaderboards in four cards rather than six.
   */
  segments: AppAnalyticsLeaderboardSegment[];
  /**
   * Narrow the whole page to one value of this segment's dimension. The rows
   * are how a filter is reached; the page is where it means something.
   */
  onPick: (
    dimension: InsightsDimensionResource["dimension"],
    value: string,
  ) => void;
}

/**
 * One leaderboard card, optionally holding two.
 *
 * The page used to draw one card per leaderboard, six of them stacked at equal
 * weight, so the page was a column of things rather than a shape you could read
 * at a glance. Pairing the two that answer neighbouring questions - pages with
 * entry pages, referrers with campaigns - is what makes the overview dense
 * enough to be an overview.
 */
const AppAnalyticsLeaderboard = (props: AppAnalyticsLeaderboardProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { testId, segments, onPick } = props;
  const [active, setActive] = useState<string>(segments[0]?.dimension ?? "");

  const note = (segment: AppAnalyticsLeaderboardSegment) =>
    segment.note ? (
      <p className="text-muted-foreground mb-3 text-xs">{segment.note}</p>
    ) : null;

  const body = (segment: AppAnalyticsLeaderboardSegment) =>
    segment.rows.length > 0 ? (
      <div className="flex flex-col gap-2">
        {segment.rows.map((row) => (
          <button
            key={row.value}
            type="button"
            className="hover:bg-muted/50 -mx-2 flex flex-col gap-1 rounded px-2 py-1 text-left transition-colors"
            onClick={() => onPick(segment.dimension, row.value)}
          >
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{row.label}</span>
              <span className="text-muted-foreground shrink-0 tabular-nums">
                {row.count.toLocaleString()} · {row.percentage}%
              </span>
            </div>
            {/*
              The bar is the reason a row is legible without reading its
              number: a share is a length before it is a percentage.
            */}
            <div className="bg-muted h-1.5 w-full overflow-hidden rounded">
              <div
                className="bg-primary h-full rounded"
                style={{ width: `${row.percentage}%` }}
              />
            </div>
          </button>
        ))}
      </div>
    ) : (
      <p className="text-muted-foreground py-8 text-center text-sm">
        {tr("insights.empty")}
      </p>
    );

  const footer = (segment: AppAnalyticsLeaderboardSegment) => (
    <Link
      href={segment.href}
      className="text-muted-foreground hover:text-foreground mt-3 inline-block text-xs transition-colors"
    >
      {tr("insights.more")}
    </Link>
  );

  if (segments.length === 1 && segments[0]) {
    const only = segments[0];
    return (
      <Card data-testid={testId}>
        <CardHeader>
          <CardTitle className="text-base">{only.title}</CardTitle>
        </CardHeader>
        <CardContent>
          {note(only)}
          {body(only)}
          {footer(only)}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid={testId}>
      <Tabs value={active} onValueChange={(value) => setActive(String(value))}>
        <CardHeader>
          <TabsList>
            {segments.map((segment) => (
              <TabsTrigger key={segment.dimension} value={segment.dimension}>
                {segment.title}
              </TabsTrigger>
            ))}
          </TabsList>
        </CardHeader>
        <CardContent>
          {segments.map((segment) => (
            <TabsContent key={segment.dimension} value={segment.dimension}>
              {note(segment)}
              {body(segment)}
              {footer(segment)}
            </TabsContent>
          ))}
        </CardContent>
      </Tabs>
    </Card>
  );
};

export default AppAnalyticsLeaderboard;
