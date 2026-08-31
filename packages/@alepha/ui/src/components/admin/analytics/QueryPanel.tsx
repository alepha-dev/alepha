import type { AdminDatasetDescriptor } from "alepha/api/analytics";
import { useI18n } from "alepha/react/i18n";
import type { PointerEvent } from "react";

import { AdvancedSection } from "./AdvancedSection.tsx";
import { DatasetSelect } from "./DatasetSelect.tsx";
import { FilterEditor } from "./FilterEditor.tsx";
import { GroupByChips } from "./GroupByChips.tsx";
import { MeasureChips } from "./MeasureChips.tsx";
import { RangeControl } from "./RangeControl.tsx";
import { RunFooter } from "./RunFooter.tsx";
import type { AnalyticsQueryApi } from "./useAnalyticsQuery.ts";

export interface QueryPanelProps {
  datasets: AdminDatasetDescriptor[];
  dataset: AdminDatasetDescriptor;
  query: AnalyticsQueryApi;
  width: number;
  onStartResize: (event: PointerEvent) => void;
  onRequest: () => void;
}

/**
 * The whole left panel, reading top to bottom as one sentence: `from`,
 * `select`, `on range`, `group by`, `where`, then the rarely-touched clauses
 * behind `advanced`.
 *
 * Two parts, and the split is load-bearing: the clause list is the only thing
 * that scrolls, and the footer sits outside it so `Run query` never moves.
 */
export const QueryPanel = (props: QueryPanelProps) => {
  const { tr } = useI18n();
  const query = props.query;

  return (
    <aside
      style={{ width: props.width }}
      // No `overflow-hidden` here, deliberately. The resize strip straddles
      // the right border by design, and a clip on this box cuts off its outer
      // half: the grab target then stops one pixel INSIDE the border, so the
      // obvious place to aim for lands on the panel and nothing happens.
      // Nothing else needs the clip, since the clause list scrolls in its own
      // box.
      className="border-border bg-card/30 relative flex flex-none flex-col border-r"
    >
      {/* A 7px hit strip centred on the border: the border itself is 1px,
          which is not a target anyone hits on the first try. */}
      <div
        onPointerDown={props.onStartResize}
        title={tr("admin.analytics.resize", { default: "Drag to resize" })}
        className="absolute top-0 -right-[3px] bottom-0 z-10 w-[7px] cursor-col-resize"
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto px-4 py-[18px]">
        <DatasetSelect
          datasets={props.datasets}
          dataset={props.dataset}
          onSelect={query.selectDataset}
        />
        <MeasureChips
          measures={query.measures}
          active={query.activeMeasures}
          onToggle={query.toggleMeasure}
        />
        <RangeControl
          days={query.state.days}
          window={query.window}
          onChange={query.setDays}
        />
        <GroupByChips
          dataset={props.dataset.name}
          dimensions={query.dimensions}
          groupBy={query.state.groupBy}
          days={query.state.days}
          hotDays={query.hotDays}
          hourAllowed={query.hourAllowed}
          onToggle={query.toggleGroupBy}
        />
        <FilterEditor
          dataset={props.dataset.name}
          dimensions={query.dimensions}
          filters={query.state.filters}
          window={query.window}
          measure={query.activeMeasures[0] ?? ""}
          onApply={query.applyFilter}
          onRemove={query.removeFilter}
        />
        <AdvancedSection
          state={query.state}
          window={query.window}
          baselineWindow={query.baselineWindow}
          dirty={query.advancedDirty}
          onUntilMode={query.setUntilMode}
          onCompare={query.setCompare}
          onLimit={query.setLimit}
        />
        <span className="min-h-1 flex-1" />
      </div>
      <RunFooter
        running={query.running}
        onRun={query.run}
        onRequest={props.onRequest}
        onReset={query.reset}
      />
    </aside>
  );
};
