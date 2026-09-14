import { type ZObject, type ZType, z } from "alepha";
import type { FormModel } from "alepha/react/form";
import { useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Search } from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";

import { FilterSlot } from "../core/FilterSlot.tsx";
import { Control } from "../form/Control.tsx";
import type { SelectOption } from "../form/ControlSelect.tsx";
import type { DataTableFilterAddType } from "./DataTableFilterAdd.tsx";
import { DataTableFilterAdd } from "./DataTableFilterAdd.tsx";
import { DataTableFilterControl } from "./DataTableFilterControl.tsx";
import type { DataTableFilterOperatorOption } from "./DataTableFilterOperator.tsx";
import {
  DATA_TABLE_FILTER_OPERATORS,
  DataTableFilterOperator,
} from "./DataTableFilterOperator.tsx";
import type {
  DataTableFilterFieldOptions,
  DataTableFilterMode,
  DataTableFilterPreset,
} from "./dataTableTypes.ts";

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
 * filtered, and "Add filter" handed back a filter that was already set. The
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
 * Built and settled on the `apps/ui` showcase (`/blocks/table`) in #Q2308.
 */
export const DataTableFilterBar = (props: DataTableFilterBarProps) => {
  const { tr } = useI18n();
  const values = useFormValues(props.form) as Record<string, unknown>;
  const dialog = props.variant === "dialog";
  const modeOf = (field: DataTableFilterBarField): DataTableFilterMode =>
    field.mode ?? (field.preset === "search" ? "locked" : "optional");
  const shown = props.shown;
  const root = useRef<HTMLDivElement>(null);
  // The filter to open once React has put it on screen. A REF, not state: the
  // effect below both reads and clears it, and clearing it with `setState`
  // inside an effect is a cascading render. Nothing renders from it.
  const pendingOpen = useRef<string | undefined>(undefined);
  // Which filters held a value at the last commit - see the operator effect.
  const heldValue = useRef<Record<string, boolean>>({});

  const inputs = props.form.input as unknown as Record<
    string,
    { set: (value: unknown) => void } | undefined
  >;

  const isSet = (key: string): boolean => {
    const value = values[key];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  };

  const operatorKeyOf = (field: DataTableFilterBarField) =>
    field.operatorKey ?? `${field.key}Op`;

  // Narrowing the list, by a value or by an operator standing on its own.
  const holds = (field: DataTableFilterBarField): boolean =>
    isSet(field.key) || values[operatorKeyOf(field)] !== undefined;

  const isLocked = (field: DataTableFilterBarField) =>
    modeOf(field) === "locked";

  const operatorsOf = (
    field: DataTableFilterBarField,
  ): DataTableFilterOperatorOption[] | undefined => {
    if (!field.operators || typeof field.operators !== "string") {
      return field.operators as DataTableFilterOperatorOption[] | undefined;
    }
    // The values come from the one table the filter schema is built from; only
    // the words are this bar's. A value is labelled the same in every preset
    // it appears in, so one entry per value covers all three.
    const not = tr("dataTable.operator.prefixNot", { default: "not" });
    const labels: Record<
      string,
      Omit<DataTableFilterOperatorOption, "value">
    > = {
      is: { label: tr("dataTable.operator.is", { default: "is" }) },
      not: {
        label: tr("dataTable.operator.isNot", { default: "is not" }),
        prefix: not,
      },
      any: { label: tr("dataTable.operator.anyOf", { default: "any of" }) },
      all: {
        label: tr("dataTable.operator.allOf", { default: "all of" }),
        prefix: tr("dataTable.operator.prefixAll", { default: "all" }),
      },
      none: {
        label: tr("dataTable.operator.noneOf", { default: "none of" }),
        prefix: not,
      },
    };
    return DATA_TABLE_FILTER_OPERATORS[field.operators].map((value) => ({
      value,
      label: labels[value]?.label ?? value,
      prefix: labels[value]?.prefix,
    }));
  };

  const operatorOf = (field: DataTableFilterBarField) => {
    const operators = operatorsOf(field);
    return (
      operators?.find(
        (operator) => operator.value === values[operatorKeyOf(field)],
      ) ?? operators?.[0]
    );
  };

  /**
   * The schema a field is read with, stripped of `.optional()`: its own, or
   * `z.string()` for the search preset.
   */
  const schemaOf = (field: DataTableFilterBarField): ZType | undefined =>
    field.schema
      ? z.schema.unwrap(field.schema)
      : field.preset === "search"
        ? z.string()
        : undefined;

  /**
   * The values an enum schema, or an array of one, allows. Empty for any
   * other schema.
   */
  const enumValuesOf = (field: DataTableFilterBarField): string[] => {
    const schema = schemaOf(field);
    if (!schema) return [];
    if (z.schema.isEnum(schema)) return z.schema.enumValues(schema);
    if (z.schema.isArray(schema)) {
      const element = z.schema.unwrap(z.schema.element(schema));
      if (z.schema.isEnum(element)) return z.schema.enumValues(element);
    }
    return [];
  };

  // Live data first, then the enum the schema declares. A bare string falls
  // back to the select's own label for it.
  const itemsOf = (
    field: DataTableFilterBarField,
  ): SelectOption[] | undefined => {
    if (field.items) return field.items;
    const options = enumValuesOf(field);
    if (options.length === 0) return undefined;
    const optionLabel = field.optionLabel;
    return optionLabel
      ? options.map((value) => ({ value, label: optionLabel(value) }))
      : options;
  };

  // Classified in `Control`'s own order, so the menu names the control the
  // filter will actually draw.
  const kindOf = (field: DataTableFilterBarField): DataTableFilterAddType => {
    const schema = schemaOf(field);
    // Before the list test, as `Control` orders it: a range IS an array, and
    // tested as one it would be offered as a list and drawn as a calendar.
    if (schema && z.schema.isDateRange(schema)) return "date";
    if (
      field.items ||
      (schema && (z.schema.isEnum(schema) || z.schema.isArray(schema)))
    ) {
      return "list";
    }
    return "text";
  };

  const placeholderOf = (field: DataTableFilterBarField) =>
    field.placeholder ??
    field.control?.placeholder ??
    (field.preset === "search"
      ? tr("dataTable.search", { default: "Search" })
      : undefined);

  const labelOf = (field: DataTableFilterBarField) =>
    field.label ?? placeholderOf(field) ?? field.key;

  const iconOf = (field: DataTableFilterBarField) =>
    field.icon ?? (field.preset === "search" ? Search : undefined);

  // A filter goes back to its default operator as its value goes: an
  // operator standing with nothing to qualify still counts as a filter in the
  // table's reset button and badge, while narrowing nothing.
  const clearField = (field: DataTableFilterBarField) => {
    inputs[field.key]?.set(undefined);
    if (field.operators) inputs[operatorKeyOf(field)]?.set(undefined);
  };

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

  // Locked first, then the shown ones, both in declaration order. The dialog
  // keeps the declaration as it is: nothing there is added or removed.
  const ordered = dialog
    ? props.fields
    : [
        ...props.fields.filter((field) => isLocked(field)),
        ...props.fields.filter((field) => !isLocked(field)),
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
          const operators = operatorsOf(field);
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
                    {...field.control}
                    input={inputs[field.key] as never}
                    label=""
                    icon={iconOf(field)}
                    clearable
                    placeholder={placeholderOf(field)}
                    items={itemsOf(field) as never}
                    // The filter's name, as the control's accessible name:
                    // an empty select says only its placeholder, and a set
                    // one only its value. A name the caller gave wins.
                    inputProps={{
                      "aria-label": label,
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
                    // Sized from its content, not the trigger: the trigger
                    // grows as the reader picks, and a popup tied to it would
                    // widen under the cursor.
                    popupClassName="w-max min-w-48"
                    popupHeader={
                      operators && (
                        <DataTableFilterOperator
                          options={operators}
                          value={operator?.value}
                          onChange={(value) =>
                            inputs[operatorKeyOf(field)]?.set(value)
                          }
                        />
                      )
                    }
                  />
                </DataTableFilterControl>
              </div>
            </FilterSlot>
          );
        })}

      {!dialog && (
        <DataTableFilterAdd
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
