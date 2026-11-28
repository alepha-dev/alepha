import {
  Segmented,
  Switch,
  TooltipContent,
  TooltipTrigger,
  Tooltip as UiTooltip,
} from "@alepha/ui";
import { type I18n, ToolbarSpinner } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import AppInsightsWindowForm from "./AppInsightsWindowForm.tsx";
import {
  APP_INSIGHTS_RANGES,
  APP_INSIGHTS_TRAFFICS,
  type AppInsightsRange,
  type AppInsightsTraffic,
  useAppInsightsFilters,
} from "./useAppInsights.ts";

export interface AppInsightsControlsProps {
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
  /**
   * Whether the Compare switch applies: only Analytics draws deltas.
   */
  showCompare?: boolean;
}

/**
 * The window and the population the analytics tabs are looking at, on one
 * row: traffic, the range presets with a custom window, and Compare.
 *
 * A tab renders this for itself rather than inheriting it from `AppLayout`: a
 * range on Settings, or on a Dashboard that shows no timeline, is a control
 * that changes nothing. Every value is backed by a URL param, so a click is a
 * navigation.
 *
 * Below `md` the presets collapse into a select: eight of them overflow a
 * phone's row.
 */
const AppInsightsControls = (props: AppInsightsControlsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { range, from, to, compare, traffic, patch } = useAppInsightsFilters();
  const { loading, showTraffic, showCompare } = props;

  const presets = APP_INSIGHTS_RANGES.map((r) => ({
    value: r,
    label: tr(RANGE_LABEL[r]),
  }));

  return (
    <div className="flex flex-wrap items-center gap-2">
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
              onChange={(t) => patch({ traffic: t as AppInsightsTraffic })}
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

      <span className="hidden md:inline-flex">
        <Segmented
          data-testid="app-range"
          size="sm"
          value={range}
          onChange={(r) =>
            patch({
              range: r as AppInsightsRange,
              from: undefined,
              to: undefined,
            })
          }
          options={presets}
        />
      </span>

      {/* Keyed on the window, so a navigation (back, a link, a preset)
          re-seeds the form rather than leaving it on the old value. */}
      <AppInsightsWindowForm
        key={`${range}|${from ?? ""}|${to ?? ""}`}
        range={range}
        from={from}
        to={to}
        presets={presets}
        onPreset={(r) => patch({ range: r, from: undefined, to: undefined })}
        onDates={(next) =>
          patch({ range: undefined, from: next[0], to: next[1] })
        }
      />

      {showCompare && (
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Switch
            data-testid="app-compare"
            checked={compare}
            onCheckedChange={(on) =>
              patch({ compare: on ? "true" : undefined })
            }
          />
          {tr("insights.compare")}
        </label>
      )}

      <ToolbarSpinner loading={loading} />
    </div>
  );
};

// Literal key strings (not template-interpolated) so the i18n audit sees them.
const RANGE_LABEL: Record<
  AppInsightsRange,
  | "insights.range.1d"
  | "insights.range.7d"
  | "insights.range.30d"
  | "insights.range.90d"
  | "insights.range.thisMonth"
  | "insights.range.lastMonth"
  | "insights.range.thisYear"
  | "insights.range.12mo"
> = {
  "1d": "insights.range.1d",
  "7d": "insights.range.7d",
  "30d": "insights.range.30d",
  "90d": "insights.range.90d",
  thisMonth: "insights.range.thisMonth",
  lastMonth: "insights.range.lastMonth",
  thisYear: "insights.range.thisYear",
  "12mo": "insights.range.12mo",
};

export default AppInsightsControls;
