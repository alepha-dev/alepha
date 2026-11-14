import {
  Segmented,
  TooltipContent,
  TooltipTrigger,
  Tooltip as UiTooltip,
} from "@alepha/ui";
import { type I18n, ToolbarSpinner } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

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
      {showTraffic && (
        <UiTooltip>
          {/*
            The caveat rides on the control itself, because that is where the
            claim is made. "Humans" means "did not declare itself a crawler" -
            a scraper driving a real browser sits in that bucket, and only the
            engagement rate gives it away.

            The trigger is a wrapper rather than the `Segmented` itself: the
            trigger hands its element a `ref`, and `Segmented` measures its
            thumb through its own.
          */}
          <TooltipTrigger
            render={<span data-testid="app-traffic" className="inline-flex" />}
          >
            <Segmented
              size="sm"
              value={traffic}
              onChange={(t) =>
                onChange({ range, traffic: t as AppInsightsTraffic })
              }
              options={APP_INSIGHTS_TRAFFICS.map((t) => ({
                value: t,
                label: tr(`insights.traffic.${t}`),
              }))}
            />
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            {tr("insights.traffic.note")}
          </TooltipContent>
        </UiTooltip>
      )}

      <Segmented
        data-testid="app-range"
        size="sm"
        value={range}
        onChange={(r) => onChange({ range: r as AppInsightsRange, traffic })}
        options={APP_INSIGHTS_RANGES.map((r) => ({
          value: r,
          label: tr(`insights.range.${r}`),
        }))}
      />

      <ToolbarSpinner loading={loading} />
    </div>
  );
};

export default AppInsightsControls;
