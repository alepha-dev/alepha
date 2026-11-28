import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Segmented,
} from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { InsightsDimensionResource } from "../../../../../api/schemas/insightsDimensionResourceSchema.ts";

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
  /**
   * Distinct visitors with this value, or `null` where nobody counts them
   * (bots, or a window before visitors were counted).
   */
  visitors: number | null;
  views: number;
  /**
   * The row's share of the window's views, whole percent: the bar's length.
   */
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
   * "More": open this segment's full list, a dialog over the tab (#Q3674).
   */
  onMore: () => void;
}

export interface AppAnalyticsLeaderboardProps {
  testId: string;
  /**
   * One or two segments. Two render as tabs inside one card, which is what
   * buys the density: six leaderboards in four cards rather than six.
   */
  segments: AppAnalyticsLeaderboardSegment[];
  /**
   * Whether the Visitors column is drawn. Off under Bots, which has views
   * only.
   */
  showVisitors: boolean;
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
  const { testId, segments, onPick, showVisitors } = props;
  const [active, setActive] = useState<string>(segments[0]?.dimension ?? "");

  const note = (segment: AppAnalyticsLeaderboardSegment) =>
    segment.note ? (
      <p className="text-muted-foreground mb-3 text-xs">{segment.note}</p>
    ) : null;

  // Label, then the numbers in fixed columns so they line up down the card.
  const grid = showVisitors
    ? "grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] items-center gap-2"
    : "grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-2";

  const body = (segment: AppAnalyticsLeaderboardSegment) =>
    segment.rows.length > 0 ? (
      <div className="flex flex-col gap-1">
        <div
          className={`${grid} text-muted-foreground px-2 text-[0.6875rem] font-medium tracking-wide uppercase`}
        >
          <span />
          {showVisitors && (
            <span className="text-right">{tr("insights.column.visitors")}</span>
          )}
          <span className="text-right">{tr("insights.column.views")}</span>
        </div>
        {segment.rows.map((row) => (
          <button
            key={row.value}
            type="button"
            data-testid="insights-row"
            className={`${grid} hover:bg-hover rounded px-2 py-1 text-left text-sm transition-colors`}
            onClick={() => onPick(segment.dimension, row.value)}
          >
            {/*
              The bar sits behind the label: a share is a length before it is
              a number, and it costs the row no height.
            */}
            <span className="relative min-w-0">
              <span
                aria-hidden
                className="bg-primary/10 absolute inset-y-[-0.125rem] left-[-0.25rem] rounded"
                style={{ width: `calc(${row.percentage}% + 0.5rem)` }}
              />
              <span className="relative block truncate" title={row.value}>
                {row.label}
              </span>
            </span>
            {showVisitors && (
              <span className="text-right tabular-nums">
                {row.visitors === null ? "-" : row.visitors.toLocaleString()}
              </span>
            )}
            <span className="text-muted-foreground text-right tabular-nums">
              {row.views.toLocaleString()}
            </span>
          </button>
        ))}
      </div>
    ) : (
      <p className="text-muted-foreground py-8 text-center text-sm">
        {tr("insights.empty")}
      </p>
    );

  const footer = (segment: AppAnalyticsLeaderboardSegment) => (
    <button
      type="button"
      onClick={segment.onMore}
      className="text-muted-foreground hover:text-foreground mt-3 inline-block text-xs transition-colors"
    >
      {tr("insights.more")}
    </button>
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
      <CardHeader>
        {/* `justify-self-start`, not `self-start`: `CardHeader` is a grid,
            whose items stretch to the column's width, and `self-start` only
            aligns on the block axis (#Q3671). */}
        <Segmented
          size="sm"
          className="justify-self-start"
          value={active}
          onChange={setActive}
          options={segments.map((segment) => ({
            value: segment.dimension,
            label: segment.title,
          }))}
        />
      </CardHeader>
      <CardContent>
        {segments
          .filter((segment) => segment.dimension === active)
          .map((segment) => (
            <div key={segment.dimension}>
              {note(segment)}
              {body(segment)}
              {footer(segment)}
            </div>
          ))}
      </CardContent>
    </Card>
  );
};

export default AppAnalyticsLeaderboard;
