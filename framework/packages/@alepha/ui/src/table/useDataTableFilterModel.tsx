import { type ZObject, type ZType, z } from "alepha";
import type { FormModel } from "alepha/react/form";
import { useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Calendar, List, Search, Type } from "lucide-react";

import type { SelectOption } from "../form/ControlSelect.tsx";
import type { DataTableFilterAddType } from "./DataTableFilterAdd.tsx";
import type { DataTableFilterBarField } from "./DataTableFilterBar.tsx";
import type { DataTableFilterOperatorOption } from "./DataTableFilterOperator.tsx";
import {
  DATA_TABLE_FILTER_OPERATORS,
  DataTableFilterOperator,
} from "./DataTableFilterOperator.tsx";
import type { DataTableFilterMode } from "./dataTableTypes.ts";

/**
 * What one filter of `filters.fields` IS, read off the table's filter form:
 * its label, icon, kind, options, operators and current value, and the
 * `Control` props every place that draws it shares.
 *
 * Two places draw a filter: the bar (and its phone dialog), and the funnel in
 * a column's header (`column`). Both read it from here, so a filter cannot be
 * labelled, iconned or listed one way in the bar and another in the header.
 */
export const useDataTableFilterModel = (form: FormModel<ZObject>) => {
  const { tr } = useI18n();
  const values = useFormValues(form) as Record<string, unknown>;

  const inputs = form.input as unknown as Record<
    string,
    { set: (value: unknown) => void } | undefined
  >;

  const modeOf = (field: DataTableFilterBarField): DataTableFilterMode =>
    field.mode ?? (field.preset === "search" ? "locked" : "optional");

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
    if (z.schema.isEnum(schema)) return z.schema.enumOptions(schema);
    if (z.schema.isArray(schema)) {
      const element = z.schema.unwrap(z.schema.element(schema));
      if (z.schema.isEnum(element)) return z.schema.enumOptions(element);
    }
    return [];
  };

  // Live data first, then the enum the schema declares. A bare string falls
  // back to the select's own label for it.
  const itemsOf = (
    field: DataTableFilterBarField,
  ): SelectOption[] | undefined => {
    if (typeof field.items === "function") return field.items(values);
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
    // A `control.items` loader is a list too: a string filter whose options
    // the server searches (the audit log's Actor, #Q3432) opened its header
    // funnel as a text box.
    if (
      field.items ||
      field.control?.items ||
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

  // Every filter has an icon, as every `Control` does: the caller's, the
  // search glyph for the search preset, else its kind's (the same glyphs the
  // controls fall back to). Without the last step a filter the caller gave no
  // icon was the one bare row of the add menu ("When", beside "Resource" and
  // "What").
  const iconOf = (field: DataTableFilterBarField) => {
    if (field.icon) return field.icon;
    if (field.preset === "search") return Search;
    const kind = kindOf(field);
    if (kind === "date") return Calendar;
    if (kind === "list") return List;
    return Type;
  };

  // A filter goes back to its default operator as its value goes: an
  // operator standing with nothing to qualify still counts as a filter in the
  // table's reset button and badge, while narrowing nothing.
  const clearField = (field: DataTableFilterBarField) => {
    inputs[field.key]?.set(undefined);
    if (field.operators) inputs[operatorKeyOf(field)]?.set(undefined);
  };

  /**
   * The `Control` props a filter carries wherever it is drawn: its input, its
   * options, its icon and placeholder, its accessible name, and the operator
   * switch at the top of its list. The bar adds its trigger's prefix and
   * width; the header adds its funnel.
   */
  const controlPropsOf = (field: DataTableFilterBarField) => {
    const operators = operatorsOf(field);
    const operator = operatorOf(field);
    return {
      ...field.control,
      input: inputs[field.key] as never,
      label: "",
      icon: iconOf(field),
      clearable: true,
      placeholder: placeholderOf(field),
      // The field's options, or else the control's own: a `control.items`
      // loader (a server-searched user picker, #Q3432) was replaced by
      // `undefined` here and the picker opened empty.
      items: itemsOf(field) ?? field.control?.items,
      // Sized from its content, not the trigger: the trigger grows as the
      // reader picks, and a popup tied to it would widen under the cursor.
      popupClassName: "w-max min-w-48",
      popupHeader: operators && (
        <DataTableFilterOperator
          options={operators}
          value={operator?.value}
          onChange={(value) => inputs[operatorKeyOf(field)]?.set(value)}
        />
      ),
    };
  };

  return {
    values,
    inputs,
    modeOf,
    isSet,
    holds,
    isLocked,
    operatorKeyOf,
    operatorsOf,
    operatorOf,
    itemsOf,
    kindOf,
    placeholderOf,
    labelOf,
    iconOf,
    clearField,
    controlPropsOf,
  };
};

/**
 * What `useDataTableFilterModel` returns.
 */
export type DataTableFilterModel = ReturnType<typeof useDataTableFilterModel>;
