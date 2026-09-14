import type { ZObject } from "alepha";
import type { FormModel } from "alepha/react/form";
import { useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { FilterSlot } from "../core/FilterSlot.tsx";
import type { ControlProps } from "../form/Control.tsx";
import { Control } from "../form/Control.tsx";
import type { SelectOption } from "../form/ControlSelect.tsx";
import type { IconComponent } from "../form/iconHint.tsx";
import type { AlephaTableFilterAddType } from "./AlephaTableFilterAdd.tsx";
import { AlephaTableFilterAdd } from "./AlephaTableFilterAdd.tsx";
import { AlephaTableFilterControl } from "./AlephaTableFilterControl.tsx";
import type {
  AlephaTableFilterOperatorOption,
  AlephaTableFilterOperatorPreset,
} from "./AlephaTableFilterOperator.tsx";
import {
  ALEPHA_TABLE_FILTER_OPERATORS,
  AlephaTableFilterOperator,
} from "./AlephaTableFilterOperator.tsx";

export interface AlephaTableFilterBarProps {
  /**
   * The form `AlephaTable` hands to `filters.render`. Every `key` below names
   * one of its fields, and so does every operator key.
   */
  form: FormModel<ZObject>;

  /**
   * The search box: always on the bar, never removable, and cleared by its
   * own in-field cross. Omit for a bar without one.
   */
  search?: AlephaTableFilterBarSearch;

  /**
   * Every other filter, in the order the add menu lists them. A caller with a
   * filter that has nothing to offer yet (a project with no areas) leaves it
   * out of this array rather than hiding it.
   */
  fields: AlephaTableFilterBarField[];
}

/**
 * A filter bar for `AlephaTable`: the search box alone, and every other
 * filter added by the reader. Mount it from `filters.render`:
 *
 * ```tsx
 * filters={{
 *   schema,
 *   render: (form) => (
 *     <AlephaTableFilterBar
 *       form={form}
 *       search={{ placeholder: "Search" }}
 *       fields={[
 *         { key: "status", label: "Status", items, operators: "is" },
 *         { key: "tags", label: "Tags", items: tags, operators: "any-all-none" },
 *       ]}
 *     />
 *   ),
 * }}
 * ```
 *
 * **The bar starts with the search box alone.** Showing every filter a table
 * supports spends the width of the bar on questions nobody has asked; four
 * boxes reading "Any status", "Any team", "Any role" say only that those
 * columns exist.
 *
 * ⚠️ "Alone" means alone among EMPTY filters. A filter holding a value, or a
 * non-default operator, is always on the bar however it got there. Which
 * filters are shown is this component's state and it starts empty on every
 * mount; the values are the table's and they outlive it - restored from
 * persistence, read from a shared link, carried across every remount a
 * `key` change causes. Keyed on the state alone, the bar came back empty
 * while the table stayed filtered, and "Add filter" handed back a filter that
 * was already set.
 *
 * **Operators** are optional per field, and each is a field of its own in the
 * filters schema, `<key>Op` unless `operatorKey` says otherwise. The backend
 * must declare the same key and values; a default operator sends no key at
 * all. See `AlephaTableFilterOperator` for why it is one switch rather than an
 * EQUAL toggle beside an OR/AND one.
 *
 * Built and settled on the `apps/ui` showcase (`/blocks/table`) in #Q2308.
 */
export const AlephaTableFilterBar = (props: AlephaTableFilterBarProps) => {
  const { tr } = useI18n();
  const values = useFormValues(props.form) as Record<string, unknown>;
  const [shown, setShown] = useState<string[]>([]);
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

  const operatorKeyOf = (field: AlephaTableFilterBarField) =>
    field.operatorKey ?? `${field.key}Op`;

  const operatorsOf = (
    field: AlephaTableFilterBarField,
  ): AlephaTableFilterOperatorOption[] | undefined => {
    if (!field.operators || typeof field.operators !== "string") {
      return field.operators as AlephaTableFilterOperatorOption[] | undefined;
    }
    // The values come from the one table the filter schema is built from; only
    // the words are this bar's. A value is labelled the same in every preset
    // it appears in, so one entry per value covers all three.
    const not = tr("alephaTable.operator.prefixNot", { default: "not" });
    const labels: Record<
      string,
      Omit<AlephaTableFilterOperatorOption, "value">
    > = {
      is: { label: tr("alephaTable.operator.is", { default: "is" }) },
      not: {
        label: tr("alephaTable.operator.isNot", { default: "is not" }),
        prefix: not,
      },
      any: { label: tr("alephaTable.operator.anyOf", { default: "any of" }) },
      all: {
        label: tr("alephaTable.operator.allOf", { default: "all of" }),
        prefix: tr("alephaTable.operator.prefixAll", { default: "all" }),
      },
      none: {
        label: tr("alephaTable.operator.noneOf", { default: "none of" }),
        prefix: not,
      },
    };
    return ALEPHA_TABLE_FILTER_OPERATORS[field.operators].map((value) => ({
      value,
      label: labels[value]?.label ?? value,
      prefix: labels[value]?.prefix,
    }));
  };

  const operatorOf = (field: AlephaTableFilterBarField) => {
    const operators = operatorsOf(field);
    return (
      operators?.find(
        (operator) => operator.value === values[operatorKeyOf(field)],
      ) ?? operators?.[0]
    );
  };

  // A filter goes back to its default operator as its value goes: an
  // operator standing with nothing to qualify still counts as a filter in the
  // table's reset button and badge, while narrowing nothing.
  const clearField = (field: AlephaTableFilterBarField) => {
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
    // imperative "open" - a combobox owns that state. A text filter has no
    // list, so it is focused instead. Scoped to this bar, so two tables on
    // one page cannot open each other's filters.
    const slot = root.current?.querySelector(`[data-filter="${key}"]`);
    const trigger = slot?.querySelector<HTMLElement>(
      '[data-slot="combobox-trigger"]',
    );
    if (trigger) {
      trigger.click();
      return;
    }
    slot?.querySelector<HTMLInputElement>('[data-slot="input"]')?.focus();
  }, [shown]);

  useEffect(() => {
    // The other way a value empties: unticked inside the list rather than
    // cleared by the button. Only on the transition from set to empty, so a
    // reader who picks "is not" BEFORE picking a value keeps it, and a
    // persisted operator survives the mount it is restored on.
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
  //
  // Set during render, which React supports for state derived from props: it
  // re-renders before committing, with no frame of the bar without the
  // filter. The guard stops it looping - it only fires while something is
  // missing, and the update adds exactly that.
  const unshown = props.fields
    .filter(
      (field) =>
        (isSet(field.key) || values[operatorKeyOf(field)] !== undefined) &&
        !shown.includes(field.key),
    )
    .map((field) => field.key);
  if (unshown.length > 0) {
    setShown([...shown, ...unshown]);
  }

  const searchKey = props.search?.key ?? "search";
  const searchPlaceholder =
    props.search?.placeholder ??
    tr("alephaTable.search", { default: "Search" });

  return (
    // `contents`, so the slots are items of the table's own wrapping row (and
    // of the phone dialog's grid) exactly as a caller's bare fragment is.
    <div ref={root} className="contents">
      {props.search && (
        <FilterSlot>
          {/*
            Given neither `onClear` nor `onRemove`: the container draws no
            button, and the input keeps its own classic cross.
          */}
          <AlephaTableFilterControl label={searchPlaceholder}>
            <Control
              {...props.search.control}
              input={inputs[searchKey] as never}
              label=""
              icon={props.search.icon ?? Search}
              placeholder={searchPlaceholder}
            />
          </AlephaTableFilterControl>
        </FilterSlot>
      )}

      {props.fields
        .filter((field) => shown.includes(field.key))
        .map((field) => {
          const operators = operatorsOf(field);
          const operator = operatorOf(field);
          return (
            <FilterSlot key={field.key}>
              <div data-filter={field.key}>
                <AlephaTableFilterControl
                  label={field.label}
                  active={isSet(field.key)}
                  // A cross empties a filter holding a value; a funnel-x
                  // removes an empty one. `active` picks between the two.
                  onClear={() => clearField(field)}
                  onRemove={() => {
                    clearField(field);
                    setShown((keys) => keys.filter((key) => key !== field.key));
                  }}
                >
                  <Control
                    {...field.control}
                    input={inputs[field.key] as never}
                    label=""
                    icon={field.icon}
                    clearable
                    placeholder={
                      field.placeholder ?? field.control?.placeholder
                    }
                    items={field.items as never}
                    // The filter's name, and a non-default operator, muted in
                    // front of the value: "Status not Active". An empty
                    // select draws no prefix; its placeholder names it.
                    triggerPrefix={[field.label, operator?.prefix]
                      .filter(Boolean)
                      .join(" ")}
                    // Sized from its content, not the trigger: the trigger
                    // grows as the reader picks, and a popup tied to it would
                    // widen under the cursor.
                    popupClassName="w-max min-w-48"
                    popupHeader={
                      operators && (
                        <AlephaTableFilterOperator
                          options={operators}
                          value={operator?.value}
                          onChange={(value) =>
                            inputs[operatorKeyOf(field)]?.set(value)
                          }
                        />
                      )
                    }
                  />
                </AlephaTableFilterControl>
              </div>
            </FilterSlot>
          );
        })}

      <AlephaTableFilterAdd
        items={props.fields
          .filter((field) => !shown.includes(field.key))
          .map((field) => ({
            key: field.key,
            label: field.label,
            icon: field.icon,
            type: (field.items ? "list" : "text") as AlephaTableFilterAddType,
          }))}
        onAdd={(key) => {
          pendingOpen.current = key;
          setShown((keys) => [...keys, key]);
        }}
      />
    </div>
  );
};

export interface AlephaTableFilterBarSearch {
  /**
   * The form field. Defaults to `search`.
   */
  key?: string;
  /**
   * Defaults to the kit's "Search".
   */
  placeholder?: string;
  icon?: IconComponent;
  /**
   * Anything else `Control` takes, such as `inputProps` for a test id.
   */
  control?: Omit<ControlProps, "input" | "label">;
}

export interface AlephaTableFilterBarField {
  /**
   * The form field this filter writes.
   */
  key: string;
  /**
   * What the filter is called: the add menu's item, the muted name on a set
   * trigger, and the accessible name of its button.
   */
  label: string;
  icon?: IconComponent;
  /**
   * Shown while the filter is empty. Falls back to `control.clearLabel`, the
   * way `Control` already does.
   */
  placeholder?: string;
  /**
   * The options of a list filter. Absent makes it a text filter, and says so
   * in the add menu.
   */
  items?: SelectOption[];
  /**
   * How the value may be compared: a preset labelled by the kit, or a list of
   * your own with the default FIRST. Absent draws no switch.
   */
  operators?:
    | AlephaTableFilterOperatorPreset
    | readonly AlephaTableFilterOperatorOption[];
  /**
   * The form field the operator is stored in. Defaults to `<key>Op`.
   */
  operatorKey?: string;
  /**
   * Anything else `Control` takes: `countLabel`, `searchable`, `inputProps`.
   * The bar owns `clearable`, the prefix and the popup, and overrides them.
   */
  control?: Omit<ControlProps, "input" | "label">;
}
