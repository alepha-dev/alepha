import { Button } from "@alepha/ui/components/ui/button";
import { Input } from "@alepha/ui/components/ui/input";
import { cn } from "@alepha/ui/lib/utils";
import { useI18n } from "alepha/react/i18n";
import { Check, ChevronLeft, Plus } from "lucide-react";
import { useState } from "react";

import { analyticsNumber } from "./analyticsModel.ts";
import type { FilterValue } from "./useFilterValues.ts";

export interface FilterValuePickerProps {
  dim: string;
  values: FilterValue[];
  initial: string[];
  loading: boolean;
  onBack: () => void;
  onApply: (values: string[]) => void;
}

/**
 * Step two of the `where` picker: which values of one dimension.
 *
 * The list is what the current window actually contains, biggest first, so a
 * value that never occurred is never offered. Typing one that is not in the
 * list offers it anyway: the list is an observation, and filtering on a value
 * that has not been seen yet is a legitimate thing to ask.
 */
export const FilterValuePicker = (props: FilterValuePickerProps) => {
  const { tr } = useI18n();
  const [selected, setSelected] = useState<string[]>(props.initial);
  const [search, setSearch] = useState("");

  const query = search.trim().toLowerCase();
  const shown = props.values
    .filter((entry) => !query || entry.value.toLowerCase().includes(query))
    .slice(0, 40);
  const typed = search.trim();
  const custom =
    typed.length > 0 && !props.values.some((entry) => entry.value === typed);

  const toggle = (value: string) => {
    setSelected((current) =>
      current.includes(value)
        ? current.filter((entry) => entry !== value)
        : [...current, value],
    );
  };

  return (
    <>
      <div className="flex items-center gap-2 px-1 pt-0.5 pb-2">
        <Button
          type="button"
          variant="outline"
          size="icon-xs"
          onClick={props.onBack}
          aria-label={tr("admin.analytics.backToDimensions", {
            default: "Back to dimensions",
          })}
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        <code className="min-w-0 flex-1 text-[12px] font-medium">
          {props.dim}
        </code>
        <span className="text-muted-foreground text-[10.5px]">
          {props.loading
            ? tr("admin.analytics.loadingValues", { default: "reading…" })
            : tr("admin.analytics.valuesInWindow", {
                default: "$1 in window",
                args: [analyticsNumber(props.values.length)],
              })}
        </span>
      </div>
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={tr("admin.analytics.searchValue", {
          default: "Search or type an exact value…",
        })}
        className="mb-1.5 h-[30px] text-[12px]"
      />
      <div className="flex max-h-[220px] flex-col gap-px overflow-auto">
        {shown.map((entry) => {
          const on = selected.includes(entry.value);
          return (
            <button
              key={entry.value}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(entry.value)}
              className="hover:bg-muted/60 focus-visible:ring-ring/50 flex w-full items-center gap-2 rounded-md px-2 py-1.5 focus-visible:ring-[3px] focus-visible:outline-none"
            >
              <span
                className={cn(
                  "inline-flex size-[15px] flex-none items-center justify-center rounded-[4px]",
                  on ? "bg-primary" : "ring-border ring-1 ring-inset",
                )}
              >
                {on && <Check className="text-primary-foreground size-2.5" />}
              </span>
              <code className="min-w-0 flex-1 truncate text-left text-[12px]">
                {entry.value}
              </code>
              <span className="text-muted-foreground text-[10.5px] tabular-nums">
                {analyticsNumber(entry.total)}
              </span>
            </button>
          );
        })}
        {custom && (
          <button
            type="button"
            onClick={() => {
              toggle(typed);
              setSearch("");
            }}
            className="bg-muted/40 hover:bg-muted text-muted-foreground focus-visible:ring-ring/50 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 focus-visible:ring-[3px] focus-visible:outline-none"
          >
            <Plus className="size-[11px]" />
            <code className="text-[12px]">use "{typed}"</code>
          </button>
        )}
      </div>
      <div className="border-border mt-1.5 flex items-center gap-2 border-t pt-2">
        <span className="text-muted-foreground flex-1 text-[10.5px]">
          {selected.length > 1
            ? tr("admin.analytics.hintInArray", {
                default: "$1 values, sent as inArray",
                args: [String(selected.length)],
              })
            : selected.length === 1
              ? tr("admin.analytics.hintEquality", {
                  default: "1 value, sent as equality",
                })
              : tr("admin.analytics.hintPick", {
                  default: "pick one or more",
                })}
        </span>
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => setSelected([])}
        >
          {tr("admin.analytics.clear", { default: "Clear" })}
        </Button>
        <Button type="button" size="xs" onClick={() => props.onApply(selected)}>
          {tr("admin.analytics.apply", { default: "Apply" })}
        </Button>
      </div>
    </>
  );
};
