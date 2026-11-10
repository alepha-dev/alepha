import type { ZObject } from "alepha";
import type { FormModel } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Funnel } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "../core/Popover.tsx";
import { cn } from "../core/utils.ts";
import { Control } from "../form/Control.tsx";
import type { DataTableFilterBarField } from "./DataTableFilterBar.tsx";
import { useDataTableFilterModel } from "./useDataTableFilterModel.tsx";

export interface DataTableHeaderFilterProps {
  /**
   * The table's filter form, the one the bar writes.
   */
  form: FormModel<ZObject>;
  /**
   * The filter this funnel opens: a field of `filters.fields` naming this
   * column in its `column`.
   */
  field: DataTableFilterBarField;
  /**
   * The filters on the bar, and how to change them: see
   * `DataTableFilterBarProps.shown`. Read to take a filter emptied here back
   * off the bar.
   */
  shown: readonly string[];
  onShownChange: (shown: string[], act: boolean) => void;
}

/**
 * The funnel in a column's header, and the filter it opens in place.
 *
 * ```text
 * Status ⇅ ⏷        a dim funnel: the column can be filtered
 * Status ⇅ ⏷        a filled, accent funnel: it is
 * ```
 *
 * The funnel IS the control's trigger: a list or a date range opens its own
 * popup from it (`Control`'s `trigger`), so the reader meets exactly the list
 * the bar would have shown them, operator switch included, one click away
 * from the column it narrows. A text filter has no popup of its own, so it
 * gets a popover holding its box.
 *
 * **The bar still shows a filter set here.** The bar's own rule puts a
 * filter holding a value on it, and that rule is not bent for this: a column
 * scrolled off, hidden, or simply far from where the reader is looking would
 * otherwise narrow the list with nothing on screen saying why.
 *
 * **Emptied here, it leaves the bar again**, when it is `optional` and came
 * onto the bar by holding a value: a header used to try a filter and put it
 * back would otherwise leave an empty "Any status" behind every time. Decided
 * when the popup closes, never while it is open, and only for a filter that
 * this popup emptied or that joined the bar while it was open: a filter the
 * reader put on the bar themselves and opened here without changing stays.
 *
 * Built in #Q3288.
 */
export const DataTableHeaderFilter = (props: DataTableHeaderFilterProps) => {
  const { tr } = useI18n();
  const model = useDataTableFilterModel(props.form);
  const { field } = props;
  const label = model.labelOf(field);
  const active = model.holds(field);
  const kind = model.kindOf(field);
  // What the filter was as the popup opened: see the docblock.
  const atOpen = useRef({ held: false, shown: false });
  // Counts the closes. The check runs in an effect after the render a close
  // causes, never in the close handler itself: a list closes in the SAME
  // event that deselects its row, before the form has the empty value, so
  // the handler would still read the filter as set.
  const [closes, setCloses] = useState(0);

  const onPopupOpenChange = (open: boolean) => {
    if (open) {
      atOpen.current = {
        held: model.holds(field),
        shown: props.shown.includes(field.key),
      };
      return;
    }
    setCloses((count) => count + 1);
  };

  useEffect(() => {
    if (closes === 0) return;
    if (model.modeOf(field) !== "optional") return;
    if (model.holds(field)) return;
    if (!props.shown.includes(field.key)) return;
    if (!atOpen.current.held && atOpen.current.shown) return;
    props.onShownChange(
      props.shown.filter((key) => key !== field.key),
      true,
    );
  }, [closes]);

  const funnel = (
    <button
      type="button"
      // How the header row's context menu finds it: "Filter" clicks it.
      data-header-filter={field.key}
      data-active={active ? "" : undefined}
      aria-label={tr("dataTable.filterColumn", {
        default: `Filter: ${label}`,
        args: [label],
      })}
      className={cn(
        "focus-visible:ring-ring/50 inline-flex size-5 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-2",
        "hover:bg-foreground/5 transition-[opacity,color]",
        // Dimmed at rest like the sort glyph beside it, so a row of them
        // does not shout; the accent and the fill say "this one is set".
        active
          ? "text-primary"
          : "text-muted-foreground opacity-50 hover:opacity-100",
      )}
    >
      <Funnel
        className="size-3.5"
        fill={active ? "currentColor" : "none"}
        aria-hidden
      />
    </button>
  );

  if (kind === "text") {
    return (
      <Popover onOpenChange={onPopupOpenChange}>
        <PopoverTrigger render={funnel}>{funnel.props.children}</PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-2">
          <Control
            {...model.controlPropsOf(field)}
            inputProps={{ "aria-label": label, ...field.control?.inputProps }}
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- the reader just opened this popover to type into its one field
            autoFocus
          />
        </PopoverContent>
      </Popover>
    );
  }

  return (
    // `inline-flex`, so the control's own field wrapper sits on the header's
    // line rather than starting a block under the label.
    <div className="inline-flex align-middle">
      <Control
        {...model.controlPropsOf(field)}
        // The funnel names itself; a caller's field name would only replace
        // "Filter: Status" with "Status" on a button that opens a list.
        inputProps={undefined}
        trigger={funnel}
        onPopupOpenChange={onPopupOpenChange}
      />
    </div>
  );
};
