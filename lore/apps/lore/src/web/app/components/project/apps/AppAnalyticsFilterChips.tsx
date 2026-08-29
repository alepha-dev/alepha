import { Badge } from "@alepha/ui/components/ui/badge";
import { useI18n } from "alepha/react/i18n";
import { X } from "lucide-react";

import type { I18n } from "../../../services/I18n.ts";
import {
  APP_INSIGHTS_FILTER_KEYS,
  type AppInsightsFilterKey,
} from "./useAppInsights.ts";

// Literal key strings (not template-interpolated) so the i18n audit sees them.
const LABEL: Record<
  AppInsightsFilterKey,
  | "insights.filter.path"
  | "insights.filter.country"
  | "insights.filter.referrer"
  | "insights.filter.campaign"
  | "insights.filter.device"
> = {
  path: "insights.filter.path",
  country: "insights.filter.country",
  referrer: "insights.filter.referrer",
  campaign: "insights.filter.campaign",
  device: "insights.filter.device",
};

export interface AppAnalyticsFilterChipsProps {
  filters: Partial<Record<AppInsightsFilterKey, string>>;
  onClear: (key: AppInsightsFilterKey) => void;
  onClearAll: () => void;
}

/**
 * The narrowing currently applied, one chip per dimension.
 *
 * Chips rather than a filter bar because the filters are picked off the
 * leaderboards, not chosen from a list of fields: what exists to be filtered by
 * is whatever the data contains, and a form would have to enumerate it.
 *
 * ⚠️ **The traffic control is deliberately NOT a chip.** It is a mode, not a
 * value: it decides which population every number describes, it is one of a
 * fixed three rather than one of whatever the window happens to hold, and it is
 * the only filter `uniqueVisitors` can honour (`sigil_uniques_daily` carries a
 * `traffic` column and no other dimension). Folding it in here would put a mode
 * and a value in the same row and imply the count narrows with both. It stays a
 * segmented control beside the range, which is the other mode.
 */
const AppAnalyticsFilterChips = (props: AppAnalyticsFilterChipsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { filters, onClear, onClearAll } = props;

  const active = APP_INSIGHTS_FILTER_KEYS.filter((key) => filters[key]);
  if (active.length === 0) {
    return null;
  }

  return (
    <div
      data-testid="insights-filters"
      className="flex flex-wrap items-center gap-2"
    >
      {active.map((key) => (
        <Badge key={key} variant="secondary" className="gap-1.5">
          <span className="text-muted-foreground">{tr(LABEL[key])}</span>
          <span className="max-w-48 truncate">{filters[key]}</span>
          <button
            type="button"
            aria-label={tr("insights.filter.clear", {
              args: [String(tr(LABEL[key]))],
            })}
            onClick={() => onClear(key)}
            className="hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      {active.length > 1 && (
        <button
          type="button"
          onClick={onClearAll}
          className="text-muted-foreground hover:text-foreground text-xs transition-colors"
        >
          {tr("insights.filter.clearAll")}
        </button>
      )}
    </div>
  );
};

export default AppAnalyticsFilterChips;
