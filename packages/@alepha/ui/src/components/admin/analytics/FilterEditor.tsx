import { Button } from "@alepha/ui/components/ui/button";
import { useI18n } from "alepha/react/i18n";
import { Pencil, Plus, X } from "lucide-react";
import { useCallback, useState } from "react";

import { analyticsFilterLabel, analyticsNumber } from "./analyticsModel.ts";
import type { AnalyticsFilterChip, AnalyticsWindow } from "./analyticsTypes.ts";
import { ClauseLabel } from "./ClauseLabel.tsx";
import { FilterValuePicker } from "./FilterValuePicker.tsx";
import { useDismissable } from "./useDismissable.ts";
import { useFilterValues } from "./useFilterValues.ts";

export interface FilterEditorProps {
  dataset: string;
  dimensions: string[];
  filters: AnalyticsFilterChip[];
  window: AnalyticsWindow;
  measure: string;
  onApply: (dim: string, values: string[]) => void;
  onRemove: (dim: string) => void;
}

/**
 * The `where` clause: the active filters, and a two-step picker for adding
 * one.
 *
 * The picker expands inline, inside the panel, rather than as an absolutely
 * positioned popover: the panel is a scroller, and a positioned popover gets
 * clipped by it.
 *
 * The chips are accent-bordered, never red. Red means failed validation
 * everywhere else in this panel; these are working filters.
 */
export const FilterEditor = (props: FilterEditorProps) => {
  const { tr } = useI18n();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setEditing(null);
  }, []);
  useDismissable({ open, onClose: close, selector: "[data-filter-picker]" });

  const { values, loading } = useFilterValues({
    dataset: props.dataset,
    dimensions: props.dimensions,
    window: props.window,
    filters: props.filters,
    measure: props.measure,
    open,
  });

  return (
    <div className="flex flex-col gap-[7px]">
      <ClauseLabel>where</ClauseLabel>
      <div className="flex flex-wrap gap-1.5">
        {props.filters.map((filter) => (
          <span
            key={filter.dim}
            className="border-primary bg-primary/15 inline-flex h-[26px] items-center gap-1.5 rounded-md border py-0 pr-1 pl-[9px] whitespace-nowrap"
          >
            <code className="text-[11.5px]">
              {analyticsFilterLabel(filter)}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="size-[18px] opacity-75 hover:opacity-100"
              title={tr("admin.analytics.changeValues", {
                default: "Change values",
              })}
              onClick={() => {
                setOpen(true);
                setEditing(filter.dim);
              }}
            >
              {/* Both icons are 14px. Lucide's `X` sits inset within its
                  viewBox while `Pencil` runs corner to corner, so an 11px `X`
                  beside a 14px `Pencil` reads as a rendering bug. */}
              <Pencil className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="size-[18px] opacity-75 hover:opacity-100"
              title={tr("admin.analytics.removeFilter", { default: "Remove" })}
              onClick={() => props.onRemove(filter.dim)}
            >
              <X className="size-3.5" />
            </Button>
          </span>
        ))}
        <div data-filter-picker className="w-full min-w-0">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setOpen((current) => !current);
              setEditing(null);
            }}
            aria-expanded={open}
            className="text-muted-foreground border-border h-[26px] gap-1.5 rounded-md border border-dashed px-[9px] text-[12px] font-normal"
          >
            <Plus className="size-3" />
            {tr("admin.analytics.addFilter", { default: "filter" })}
          </Button>
          {open && (
            <div className="bg-background ring-border mt-1.5 w-full rounded-xl p-2 ring-1 ring-inset">
              {editing === null ? (
                <>
                  <div className="text-muted-foreground px-1.5 pt-1 pb-2 text-[11px] tracking-[0.06em] uppercase">
                    {tr("admin.analytics.pickDimension", {
                      default: "Filter on a dimension",
                    })}
                  </div>
                  {props.dimensions.map((dim) => (
                    <button
                      key={dim}
                      type="button"
                      onClick={() => setEditing(dim)}
                      className="hover:bg-muted/60 focus-visible:ring-ring/50 flex w-full items-center gap-2 rounded-md px-2 py-[7px] focus-visible:ring-[3px] focus-visible:outline-none"
                    >
                      <code className="min-w-0 flex-1 text-left text-[12px]">
                        {dim}
                      </code>
                      <span className="text-muted-foreground text-[11px] tabular-nums">
                        {loading && !values[dim]
                          ? tr("admin.analytics.loadingValues", {
                              default: "reading…",
                            })
                          : tr("admin.analytics.valueCount", {
                              default: "$1 values",
                              args: [
                                analyticsNumber((values[dim] ?? []).length),
                              ],
                            })}
                      </span>
                    </button>
                  ))}
                </>
              ) : (
                <FilterValuePicker
                  key={editing}
                  dim={editing}
                  values={values[editing] ?? []}
                  loading={loading && !values[editing]}
                  initial={
                    props.filters.find((filter) => filter.dim === editing)
                      ?.values ?? []
                  }
                  onBack={() => setEditing(null)}
                  onApply={(next) => {
                    props.onApply(editing, next);
                    close();
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
