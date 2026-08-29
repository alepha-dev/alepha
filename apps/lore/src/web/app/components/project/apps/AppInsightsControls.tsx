import {
  TooltipContent,
  TooltipTrigger,
  Tooltip as UiTooltip,
} from "@alepha/ui/components/ui/tooltip";
import { useI18n } from "alepha/react/i18n";
import { Loader2 } from "lucide-react";

import type { I18n } from "../../../services/I18n.ts";
import {
  APP_INSIGHTS_RANGES,
  APP_INSIGHTS_TRAFFICS,
  type AppInsightsRange,
  type AppInsightsTraffic,
} from "./useAppInsights.ts";

export interface AppInsightsControlsProps {
  range: AppInsightsRange;
  traffic: AppInsightsTraffic;
  loading: boolean;
  /**
   * Whether the population toggle applies to what the caller renders.
   *
   * Analytics only. `sigil_vitals` declares no `traffic` dimension, so on
   * Vitals the control would be present and inert, which reads as broken
   * rather than as absent. The value still travels in the URL, so crossing to
   * Vitals and back does not reset it.
   */
  showTraffic?: boolean;
  onChange: (next: {
    range: AppInsightsRange;
    traffic: AppInsightsTraffic;
  }) => void;
}

/**
 * The window and the population the analytics tabs are looking at.
 *
 * A tab renders this for itself rather than inheriting it from `AppLayout`: a
 * range on Settings, or on a Dashboard that shows no timeline, is a control
 * that changes nothing. Both values are backed by URL params, so this
 * component holds no state and a click is a navigation.
 */
const AppInsightsControls = (props: AppInsightsControlsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { range, traffic, loading, showTraffic, onChange } = props;

  return (
    <div className="flex items-center gap-2">
      {loading && (
        <Loader2 className="text-muted-foreground size-4 animate-spin" />
      )}

      {showTraffic && (
        <UiTooltip>
          {/*
            The caveat rides on the control itself, because that is where the
            claim is made. "Humans" means "did not declare itself a crawler" -
            a scraper driving a real browser sits in that bucket, and only the
            engagement rate gives it away.
          */}
          <TooltipTrigger
            render={
              <div
                data-testid="app-traffic"
                className="bg-muted flex gap-0.5 rounded-md p-0.5"
              >
                {APP_INSIGHTS_TRAFFICS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => onChange({ range, traffic: t })}
                    className={
                      t === traffic
                        ? "bg-background rounded px-3 py-1 text-xs font-medium shadow-sm"
                        : "text-muted-foreground rounded px-3 py-1 text-xs"
                    }
                  >
                    {tr(`insights.traffic.${t}`)}
                  </button>
                ))}
              </div>
            }
          />
          <TooltipContent className="max-w-xs">
            {tr("insights.traffic.note")}
          </TooltipContent>
        </UiTooltip>
      )}

      <div
        data-testid="app-range"
        className="bg-muted flex gap-0.5 rounded-md p-0.5"
      >
        {APP_INSIGHTS_RANGES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => onChange({ range: r, traffic })}
            className={
              r === range
                ? "bg-background rounded px-3 py-1 text-xs font-medium shadow-sm"
                : "text-muted-foreground rounded px-3 py-1 text-xs"
            }
          >
            {tr(`insights.range.${r}`)}
          </button>
        ))}
      </div>
    </div>
  );
};

export default AppInsightsControls;
