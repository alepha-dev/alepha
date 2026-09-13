import { useI18n } from "alepha/react/i18n";
import { SearchX } from "lucide-react";

export interface AnalyticsEmptyProps {
  /**
   * Whether any filter is active, which decides what the hint suggests
   * loosening.
   */
  filtered: boolean;
}

/**
 * Nothing matched.
 *
 * A distinct state from "measured zero": the ungrouped query returns no row
 * at all when nothing matched, and one row of zeroes when something did, so
 * this is only ever shown for the former.
 */
export const AnalyticsEmpty = (props: AnalyticsEmptyProps) => {
  const { tr } = useI18n();

  return (
    <div className="flex flex-col items-center gap-2 px-5 py-11">
      <SearchX className="text-muted-foreground size-5" />
      <div className="text-[13.5px]">
        {tr("admin.analytics.empty", { default: "No data for this query." })}
      </div>
      <div className="text-muted-foreground text-[12px]">
        {props.filtered
          ? tr("admin.analytics.emptyFiltered", {
              default: "Loosen a filter, or widen the window.",
            })
          : tr("admin.analytics.emptyHint", { default: "Widen the window." })}
      </div>
    </div>
  );
};
