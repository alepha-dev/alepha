import { Button } from "@alepha/ui";
import { Control, ControlDateRange } from "@alepha/ui/form";
import type { I18n } from "@lore/core/web";
import { z } from "alepha";
import { type BaseInputField, useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { CalendarRange } from "lucide-react";

import type { AppInsightsRange } from "./useAppInsights.ts";

export interface AppInsightsWindowFormProps {
  range: AppInsightsRange | "custom";
  from?: string;
  to?: string;
  presets: Array<{ value: AppInsightsRange; label: string }>;
  onPreset: (range: AppInsightsRange) => void;
  onDates: (dates: [string, string]) => void;
}

/**
 * The two form-backed controls: the preset select below `md`, and the custom
 * window's two dates. One field form, written on change: nothing is
 * submitted, picking a value IS the write.
 */
const AppInsightsWindowForm = (props: AppInsightsWindowFormProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const custom = props.range === "custom";

  const form = useForm({
    schema: z.object({
      range: z.text().optional(),
      dates: z.dateRange().optional(),
    }),
    initialValues: {
      range: custom ? undefined : props.range,
      dates: props.from && props.to ? [props.from, props.to] : undefined,
    },
    keepDirty: false,
    handler: async () => {},
    onChange: (key, value) => {
      if (key === "range" && typeof value === "string" && value) {
        props.onPreset(value as AppInsightsRange);
      }
      if (key === "dates" && Array.isArray(value) && value[0] && value[1]) {
        props.onDates([String(value[0]), String(value[1])]);
      }
    },
  });
  const inputs = form.input as unknown as Record<string, BaseInputField>;

  // A day as a calendar day: `l` on a UTC midnight, read in UTC, so a reader
  // west of Greenwich does not see the day before.
  const day = (value: string) =>
    l(new Date(`${value}T00:00:00.000Z`), {
      timezone: "UTC",
      date: { day: "numeric", month: "short" },
    });

  return (
    <>
      <div className="md:hidden" data-testid="app-range-select">
        <Control
          input={inputs.range!}
          label=""
          inputProps={{ "aria-label": tr("insights.range.label") }}
          placeholder={tr("insights.range.custom")}
          minimal
          size="xs"
          triggerClassName="w-auto"
          items={props.presets}
        />
      </div>
      <ControlDateRange
        input={inputs.dates!}
        label=""
        trigger={
          <Button
            data-testid="app-range-custom"
            variant={custom ? "solid" : "minimal"}
            intent={custom ? "primary" : "none"}
            size="sm"
          >
            <CalendarRange />
            {custom && props.from && props.to
              ? `${day(props.from)} - ${day(props.to)}`
              : tr("insights.range.custom")}
          </Button>
        }
      />
    </>
  );
};

export default AppInsightsWindowForm;
