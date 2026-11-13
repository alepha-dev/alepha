import type { ZObject } from "alepha";
import type { FormModel } from "alepha/react/form";
import { useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Asterisk } from "lucide-react";
import { Fragment } from "react";

import { cn } from "../core/utils.ts";
import { DataTablePresetRailButton } from "./DataTablePresetRailButton.tsx";
import { noFilterSet, presetMatches } from "./dataTablePresets.ts";
import type {
  DataTableFilterFields,
  DataTablePreset,
  DataTablePresets,
} from "./dataTableTypes.ts";

export interface DataTablePresetRailProps {
  form: FormModel<ZObject>;
  /**
   * Every filter key, operator keys included: what a preset is compared on.
   */
  keys: readonly string[];
  presets: DataTablePresets<DataTableFilterFields>;
  onApply: (preset: DataTablePreset<DataTableFilterFields>) => void;
  onAll: () => void;
  className?: string;
}

/**
 * The table's presets, as a narrow rail of buttons, icon above label (see
 * `DataTablePresets`). A button is lit while the form's values are exactly
 * its preset's, which is read from the form itself, so a filter changed by
 * hand turns it off and a link carrying the same values turns it on.
 */
export const DataTablePresetRail = (props: DataTablePresetRailProps) => {
  const { tr } = useI18n();
  const values = useFormValues(props.form) as Record<string, unknown>;
  const all = props.presets.all;
  const items = props.presets.items;

  return (
    <nav
      aria-label={tr("dataTable.presets", { default: "Presets" })}
      data-slot="data-table-presets"
      className={cn(
        // Joined to the table: its end edge is the table's start border, so
        // the two read as one panel. The table's chrome, as the toolbar and
        // the footer are: `bg-muted` under the `--bevel` highlight.
        "bg-muted flex w-16 shrink-0 flex-col items-center gap-0.5 overflow-y-auto rounded-md rounded-e-none border border-e-0 py-2 shadow-[inset_0_1px_0_0_var(--bevel)]",
        props.className,
      )}
    >
      {items.map((preset, index) => (
        <Fragment key={preset.key}>
          {index > 0 && items[index - 1].group !== preset.group && (
            <div aria-hidden className="bg-border my-1.5 h-px w-7 shrink-0" />
          )}
          <DataTablePresetRailButton
            label={preset.label}
            hint={preset.hint}
            icon={preset.icon}
            count={preset.count}
            tone={preset.tone}
            presetKey={preset.key}
            active={presetMatches(
              values,
              preset.values as Record<string, unknown>,
              props.keys,
            )}
            onClick={() => props.onApply(preset)}
          />
        </Fragment>
      ))}
      {all !== false && (
        <>
          <div className="flex-1" />
          <DataTablePresetRailButton
            label={
              all?.label ?? tr("dataTable.presets.all", { default: "All" })
            }
            hint={
              all?.hint ??
              tr("dataTable.presets.allHint", { default: "No filter" })
            }
            // A wildcard, not a list: the footer's page-size picker already
            // shows a list icon a few pixels away.
            icon={all?.icon ?? Asterisk}
            presetKey="all"
            active={noFilterSet(values, props.keys)}
            onClick={props.onAll}
          />
        </>
      )}
    </nav>
  );
};
