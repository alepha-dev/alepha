import type { ZObject, ZType } from "alepha";
import type { FormModel } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useEffect, useLayoutEffect, useRef } from "react";

import { FilterSlot } from "../core/FilterSlot.tsx";
import { Control } from "../form/Control.tsx";
import { DataTableFilterAdd } from "./DataTableFilterAdd.tsx";
import { DataTableFilterControl } from "./DataTableFilterControl.tsx";
import type {
  DataTableFilterFieldOptions,
  DataTableFilterPreset,
} from "./dataTableTypes.ts";
import { useDataTableFilterModel } from "./useDataTableFilterModel.tsx";

export interface DataTableFilterBarProps {
  /**
   * The table's filter form. Every `key` below names one of its fields, and
   * so does every operator key.
   */
  form: FormModel<ZObject>;

  /**
   * Every filter, in declaration order: the order the bar draws them in and
   * the add menu lists them in.
   */
  fields: DataTableFilterBarField[];

  /**
   * Which filters are on the bar. The table's state, not the bar's, because
   * three things write it: this bar, Reset filters and persistence.
   *
   * A locked field is drawn whether or not it is in here.
   */
  shown: readonly string[];

  /**
   * The shown filters changed. `act` is true for the reader's own add or
   * remove, and false when a filter joined the bar because it holds a value:
   * that is not the reader choosing anything, and must not be stored.
   */
  onShownChange: (shown: string[], act: boolean) => void;

  /**
   * `"dialog"` draws every filter, each like a locked field, and no add menu:
   * the phone dialog is already the on-demand step, and a menu per filter
   * behind that button would be a second one.
   */
  variant?: "bar" | "dialog";
}

/**
 * The filter bar `DataTable` draws from `filters.fields`: the locked filters
 * (the search box), then the filters the reader put on the bar, then the menu
 * that adds one.
 *
 * **Which filters start on the bar is the field's `mode`.** An `optional`
 * field, the default, is off it until the reader adds it; a `default` field
 * is on it from the start and removable; a `locked` field is always there and
 * never removable. Showing every filter a table supports spends the width of
 * the bar on questions nobody has asked; four boxes reading "Any status",
 * "Any team", "Any role" say only that those columns exist.
 *
 * ⚠️ **A filter holding a value, or a non-default operator, is always on the
 * bar**, whatever its mode and however it got the value: restored from
 * persistence, read from a shared link, carried across a remount. Keyed on
 * the shown state alone, the bar came back empty while the table stayed
 * filtered, and "Add filters" handed back a filter that was already set. The
 * same holds for `hidden`: an empty hidden field is off the bar and out of the
 * menu, and a hidden field narrowing the list is still drawn, or the list
 * would be narrowed with nothing on screen saying why.
 *
 * **Operators** are optional per field, and each is a field of its own in the
 * filters schema, `<key>Op` unless `operatorKey` says otherwise. The backend
 * must declare the same key and values; a default operator sends no key at
 * all. See `DataTableFilterOperator` for why it is one switch rather than an
 * EQUAL toggle beside an OR/AND one.
 *
 * Internal to the table: a table given `fields` and no `filters.render`
 * mounts it, in the toolbar and in the phone dialog.
 *
 * Built and settled on the `apps/ui` showcase (`/blocks/data-table/basic`) in #Q2308.
 */
export const DataTableFilterBar = (props: DataTableFilterBarProps) => {
  const { tr } = useI18n();
  const model = useDataTableFilterModel(props.form);
  const {
    values,
    inputs,
    isSet,
    holds,
    isLocked,
    operatorKeyOf,
    operatorOf,
    kindOf,
    placeholderOf,
    labelOf,
    iconOf,
    clearField,
  } = model;
  const dialog = props.variant === "dialog";
  const shown = props.shown;
  const root = useRef<HTMLDivElement>(null);
  // The filter to open once React has put it on screen. A REF, not state: the
  // effect below both reads and clears it, and clearing it with `setState`
  // inside an effect is a cascading render. Nothing renders from it.
  const pendingOpen = useRef<string | undefined>(undefined);
  // Which filters held a value at the last commit - see the operator effect.
  const heldValue = useRef<Record<string, boolean>>({});

  useEffect(() => {
    const key = pendingOpen.current;
    if (!key) return;
    pendingOpen.current = undefined;
    // ⚠️ Opening the new filter has to happen from OUT HERE, after the render
    // that mounts it: inside the menu's click handler the control does not
    // exist yet. Driven through the DOM because `Control` exposes no
    // imperative "open" - a combobox owns that state, and a date range's
    // popover owns its own. A text filter has no list, so it is focused
    // instead. Scoped to this bar, so two tables on one page cannot open each
    // other's filters.
    const slot = root.current?.querySelector(`[data-filter="${key}"]`);
    const trigger = slot?.querySelector<HTMLElement>(
      '[data-slot="combobox-trigger"], [data-slot="date-trigger"]',
    );
    if (trigger) {
      trigger.click();
      return;
    }
    slot?.querySelector<HTMLInputElement>('[data-slot="input"]')?.focus();
  }, [shown]);

  useEffect(() => {
    // The other way a value empties: unticked inside the list, or cleared by
    // a locked field's own cross, rather than cleared by the button. Only on
    // the transition from set to empty, so a reader who picks "is not" BEFORE
    // picking a value keeps it, and a persisted operator survives the mount
    // it is restored on.
    for (const field of props.fields) {
      const set = isSet(field.key);
      const operatorKey = operatorKeyOf(field);
      if (
        field.operators &&
        heldValue.current[field.key] &&
        !set &&
        values[operatorKey] !== undefined
      ) {
        inputs[operatorKey]?.set(undefined);
      }
      heldValue.current[field.key] = set;
    }
  }, [values]);

  // A field holding a value or an operator joins `shown` the moment it is
  // seen - see the docblock. Folded INTO `shown` rather than drawn as
  // `shown ∪ set`, because a filter visible only for holding a value would
  // unmount the instant the reader emptied it, list open and cursor on it.
  // Locked fields are drawn regardless and never join it, and the dialog
  // draws every field.
  const unshown = dialog
    ? []
    : props.fields
        .filter(
          (field) =>
            !isLocked(field) && holds(field) && !shown.includes(field.key),
        )
        .map((field) => field.key);

  // The table's state cannot be set from this component's render, so it is
  // set in a LAYOUT effect: React flushes that update synchronously, before
  // the browser paints, so no frame shows the bar without the filter. The
  // guard stops it looping - it only fires while something is missing, and
  // the update adds exactly that.
  useLayoutEffect(() => {
    if (unshown.length > 0) {
      props.onShownChange([...shown, ...unshown], false);
    }
  });

  const drawn = (field: DataTableFilterBarField): boolean => {
    if (field.hidden && !holds(field)) return false;
    if (dialog || isLocked(field)) return true;
    return shown.includes(field.key);
  };

  // Locked first, in declaration order, then the shown ones in the order they
  // joined the bar: an added filter goes to the END, beside the "+" that
  // brought it, not back to its declared slot. Added D, C, B, A reads
  // D C B A. The dialog keeps the declaration as it is: nothing there is
  // added or removed.
  const rank = (field: DataTableFilterBarField) => {
    const index = shown.indexOf(field.key);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  const ordered = dialog
    ? props.fields
    : [
        ...props.fields.filter((field) => isLocked(field)),
        ...props.fields
          .filter((field) => !isLocked(field))
          .sort((a, b) => rank(a) - rank(b)),
      ];

  return (
    // `contents`, so the slots are items of the table's own wrapping row (and
    // of the phone dialog's grid) exactly as a caller's bare fragment is.
    <div ref={root} className="contents">
      {ordered
        .filter((field) => drawn(field))
        .map((field) => {
          // In the dialog every filter is drawn like a locked one: no
          // clear-and-remove button, the control's own cross resets it.
          const removable = !dialog && !isLocked(field);
          const operator = operatorOf(field);
          const label = labelOf(field);
          return (
            <FilterSlot key={field.key}>
              <div data-filter={field.key}>
                <DataTableFilterControl
                  label={label}
                  active={isSet(field.key)}
                  // A cross empties a filter holding a value; a funnel-x
                  // removes an empty one. `active` picks between the two.
                  // A locked filter is given neither, so it keeps the cross
                  // inside its own field.
                  onClear={removable ? () => clearField(field) : undefined}
                  onRemove={
                    removable
                      ? () => {
                          clearField(field);
                          props.onShownChange(
                            shown.filter((key) => key !== field.key),
                            true,
                          );
                        }
                      : undefined
                  }
                >
                  <Control
                    {...model.controlPropsOf(field)}
                    // The filter's name, as the control's accessible name:
                    // an empty select says only its placeholder, and a set
                    // one only its value. A name the caller gave wins.
                    inputProps={{
                      "aria-label": label,
                      // A text filter is as wide as its placeholder. The slot
                      // grows from its content, and an input's content width
                      // is its `size` in characters (20 by default), so a
                      // long placeholder was cut at the slot's minimum.
                      ...(kindOf(field) === "text"
                        ? {
                            size: Math.max(
                              20,
                              placeholderOf(field)?.length ?? 0,
                            ),
                          }
                        : {}),
                      ...field.control?.inputProps,
                    }}
                    // The filter's name, and a non-default operator, muted in
                    // front of the value: "Status: not Active". An empty
                    // select draws no prefix; its placeholder names it. The
                    // colon is a catalog entry because French spaces it.
                    triggerPrefix={[
                      tr("dataTable.filterName", {
                        default: `${label}:`,
                        args: [label],
                      }),
                      operator?.prefix,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  />
                </DataTableFilterControl>
              </div>
            </FilterSlot>
          );
        })}

      {!dialog && (
        <DataTableFilterAdd
          labeled={!ordered.some((field) => drawn(field))}
          items={props.fields
            .filter(
              (field) =>
                !isLocked(field) && !field.hidden && !shown.includes(field.key),
            )
            .map((field) => ({
              key: field.key,
              label: labelOf(field),
              icon: iconOf(field),
              type: kindOf(field),
            }))}
          onAdd={(key) => {
            pendingOpen.current = key;
            props.onShownChange([...shown, key], true);
          }}
        />
      )}
    </div>
  );
};

/**
 * One filter of the bar: a field of `filters.fields` with its key, as the
 * table hands it over. `schema` is the one the table read at mount, and gives
 * the options of an enum and the kind the add menu names.
 */
export interface DataTableFilterBarField extends DataTableFilterFieldOptions {
  /**
   * The form field this filter writes.
   */
  key: string;
  schema?: ZType;
  preset?: DataTableFilterPreset;
}
