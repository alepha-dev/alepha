import { type ZObject, z } from "alepha";
import type { FormModel } from "alepha/react/form";

import { Checkbox } from "../core/Checkbox.tsx";
import type { SelectOption } from "../form/ControlSelect.tsx";
import type { DataTableFilterBarField } from "./DataTableFilterBar.tsx";
import { DataTableFilterOperator } from "./DataTableFilterOperator.tsx";
import { dataTableFilterText } from "./dataTableFilterText.ts";
import { useDataTableFilterModel } from "./useDataTableFilterModel.tsx";

/**
 * A list filter as checkboxes: several ticked for an array schema, one at a
 * time for a single value (ticking another replaces it, ticking it again
 * empties it).
 */
export interface DataTableHeaderPopupListProps {
  form: FormModel<ZObject>;
  field: DataTableFilterBarField;
  items: SelectOption[];
}

export const DataTableHeaderPopupList = (
  props: DataTableHeaderPopupListProps,
) => {
  const model = useDataTableFilterModel(props.form);
  const { field } = props;
  const schema = field.schema ? z.schema.unwrap(field.schema) : undefined;
  const multiple = schema !== undefined && z.schema.isArray(schema);
  const value = model.values[field.key];
  const selected: string[] = Array.isArray(value)
    ? (value as string[])
    : value === undefined || value === null || value === ""
      ? []
      : [dataTableFilterText(value)];
  const operators = model.operatorsOf(field);
  const operator = model.operatorOf(field);

  const toggle = (option: string) => {
    const input = model.inputs[field.key];
    if (multiple) {
      const next = selected.includes(option)
        ? selected.filter((v) => v !== option)
        : [...selected, option];
      input?.set(next.length > 0 ? next : undefined);
      return;
    }
    input?.set(selected.includes(option) ? undefined : option);
  };

  return (
    <div className="flex flex-col">
      {operators && (
        <DataTableFilterOperator
          options={operators}
          value={operator?.value}
          onChange={(next) =>
            model.inputs[model.operatorKeyOf(field)]?.set(next)
          }
        />
      )}
      <div
        role="group"
        aria-label={model.labelOf(field)}
        className="max-h-64 overflow-y-auto"
      >
        {props.items.map((item) => {
          const optionValue = typeof item === "string" ? item : item.value;
          const optionLabel = typeof item === "string" ? item : item.label;
          const checked = selected.includes(optionValue);
          return (
            <label
              key={optionValue}
              className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm"
            >
              <Checkbox
                checked={checked}
                onCheckedChange={() => toggle(optionValue)}
              />
              <span className="truncate">{optionLabel}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
};
