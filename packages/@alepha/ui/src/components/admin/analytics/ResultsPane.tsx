import { Segmented } from "@alepha/ui/components/ui/segmented";
import { Spinner } from "@alepha/ui/components/ui/spinner";
import { cn } from "@alepha/ui/lib/utils";
import { useI18n } from "alepha/react/i18n";
import { LayoutDashboard, Table } from "lucide-react";
import { useMemo } from "react";

import { AnalyticsChart } from "./AnalyticsChart.tsx";
import { AnalyticsEmpty } from "./AnalyticsEmpty.tsx";
import { analyticsNumber } from "./analyticsModel.ts";
import type { AnalyticsView } from "./analyticsTypes.ts";
import { analyticsChartModel } from "./chartModel.ts";
import { CompareNote } from "./CompareNote.tsx";
import { ResultsTable } from "./ResultsTable.tsx";
import { SamplingBadge } from "./SamplingBadge.tsx";
import { TotalsCards } from "./TotalsCards.tsx";
import { TruncationBanner } from "./TruncationBanner.tsx";
import type { AnalyticsQueryApi } from "./useAnalyticsQuery.ts";
import { useShapeLabels } from "./useShapeLabels.ts";

export interface ResultsPaneProps {
  query: AnalyticsQueryApi;
  dataset: string;
}

/**
 * The right-hand pane: an Overview of totals and one chart, or the raw Table.
 *
 * The window, the sampling badge and the baseline sit above the cards
 * deliberately. A figure in 28px type is the one that gets screenshotted into
 * a decision, so its qualifiers belong beside it rather than under the table,
 * which people already read carefully.
 */
export const ResultsPane = (props: ResultsPaneProps) => {
  const { tr } = useI18n();
  const labels = useShapeLabels();
  const query = props.query;
  const result = query.result;
  const table = query.viewState.view === "table";

  const model = useMemo(
    () =>
      result
        ? analyticsChartModel({
            rows: result.rows,
            groupBy: result.groupBy,
            measures: result.measures,
            measure: query.viewState.chartMeasure,
            axis: query.viewState.axis,
            shape: query.viewState.shape,
            untilMode: query.state.untilMode,
          })
        : null,
    [result, query.viewState, query.state.untilMode],
  );

  const stacked =
    !!model?.breakdown && (model.shape === "bars" || model.shape === "share");

  // Both notes count things that can legitimately be one: a dataset may
  // declare a single measure, and dropping every group key leaves exactly one
  // group. The repo has no plural engine, so the singular is its own key, the
  // way `quest.create.estimate.unit.*.one` already is.
  const columns = result ? result.groupBy.length + result.measures.length : 0;
  const shapeLabel = model ? labels.label(model.shape, stacked) : "";

  // Counted nouns are separate fragments rather than one sentence with two
  // numbers in it. Both can independently be one (drop every group key and it
  // is "1 group"; a one-measure dataset ungrouped is "1 column"), and folding
  // them into a single key would need a variant per combination.
  //
  // Each key is also a literal sitting directly after `tr(`. A ternary that
  // picks between two key strings reads fine but is invisible to the
  // catalogue scanner (`i18n-fr.spec.ts` and `alepha i18n check` both match
  // on `tr("..."`), so the singular would silently never be translated, which
  // is the exact rot those checks exist to catch.
  const groupsText =
    result?.groupCount === 1
      ? tr("admin.analytics.noteGroups.one", { default: "1 group" })
      : tr("admin.analytics.noteGroups", {
          default: "$1 groups",
          args: [analyticsNumber(result?.groupCount ?? 0)],
        });
  const columnsText =
    columns === 1
      ? tr("admin.analytics.noteColumns.one", { default: "1 column" })
      : tr("admin.analytics.noteColumns", {
          default: "$1 columns",
          args: [String(columns)],
        });

  const viewNote = !result
    ? ""
    : table
      ? `${groupsText} · ${columnsText}`
      : result.measures.length === 1
        ? tr("admin.analytics.overviewNote.one", {
            default: "1 measure · $1",
            args: [shapeLabel],
          })
        : tr("admin.analytics.overviewNote", {
            default: "$1 measures · $2",
            args: [String(result.measures.length), shapeLabel],
          });

  const compareLabel =
    query.state.compare === "off"
      ? null
      : query.state.compare === "lastYear"
        ? tr("admin.analytics.vsLastYear", { default: "vs last year" })
        : tr("admin.analytics.vsPrevious", {
            default: "vs previous $1d",
            args: [String(query.state.days)],
          });

  return (
    <div
      className={cn(
        "min-h-0 min-w-0 flex-1",
        table ? "flex flex-col overflow-hidden" : "overflow-auto",
      )}
    >
      <div className="flex flex-none items-center gap-2.5 px-5 pt-3.5">
        <Segmented
          size="sm"
          value={query.viewState.view}
          onChange={(value) => query.setView(value as AnalyticsView)}
          options={[
            {
              value: "overview",
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <LayoutDashboard className="size-3.5" />
                  {tr("admin.analytics.overview", { default: "Overview" })}
                </span>
              ),
            },
            {
              value: "table",
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <Table className="size-3.5" />
                  {tr("admin.analytics.table", { default: "Table" })}
                </span>
              ),
            },
          ]}
        />
        <span className="flex-1" />
        {query.running && (
          <Spinner className="text-muted-foreground size-3.5" />
        )}
        <span className="text-muted-foreground text-[11.5px]">{viewNote}</span>
      </div>

      <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 px-5 pt-3">
        <code className="text-foreground text-[11.5px]">
          {query.window.from} → {query.window.to}
        </code>
        {result && (
          <SamplingBadge
            estimated={result.estimated}
            sampleInterval={result.sampleInterval}
          />
        )}
        <CompareNote
          className="text-[11.5px]"
          compare={query.state.compare}
          days={query.state.days}
          baselineWindow={query.baselineWindow}
        />
      </div>

      {query.error && (
        <div className="text-destructive mx-5 mt-3 flex-none rounded-lg bg-red-500/10 px-3 py-2.5 text-[12.5px] ring-1 ring-red-500/40 ring-inset">
          {query.error}
        </div>
      )}

      {result && result.groupCount > result.limit && (
        <TruncationBanner
          limit={result.limit}
          groupCount={result.groupCount}
          groupCountCapped={result.groupCountCapped}
          onRaise={query.setLimit}
        />
      )}

      {result && !table && model && (
        <>
          {result.rows.length === 0 ? (
            <AnalyticsEmpty filtered={query.state.filters.length > 0} />
          ) : (
            <>
              <TotalsCards
                result={result}
                days={query.state.days}
                compareLabel={compareLabel}
              />
              <AnalyticsChart
                model={model}
                groupBy={result.groupBy}
                measures={result.measures}
                onShape={query.setShape}
                onAxis={query.setAxis}
                onMeasure={query.setChartMeasure}
              />
              <div className="h-5" />
            </>
          )}
        </>
      )}

      {result && table && (
        <ResultsTable
          result={result}
          dataset={props.dataset}
          filtered={query.state.filters.length > 0}
          onSort={query.sortBy}
        />
      )}
    </div>
  );
};
