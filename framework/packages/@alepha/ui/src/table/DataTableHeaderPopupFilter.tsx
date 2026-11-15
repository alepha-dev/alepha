import type { ZObject } from "alepha";
import type { FormModel } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import { Button } from "../core/Button.tsx";
import { Input } from "../core/Input.tsx";
import { Control } from "../form/Control.tsx";
import type { DataTableFilterBarField } from "./DataTableFilterBar.tsx";
import { dataTableFilterText } from "./dataTableFilterText.ts";
import { DataTableHeaderPopupList } from "./DataTableHeaderPopupList.tsx";
import { DataTableHeaderPopupRange } from "./DataTableHeaderPopupRange.tsx";
import { useDataTableFilterModel } from "./useDataTableFilterModel.tsx";

/**
 * The filter part of the popup, and its « Reset ».
 */
export interface DataTableHeaderPopupFilterProps {
  form: FormModel<ZObject>;
  fields: DataTableFilterBarField[];
}

export const DataTableHeaderPopupFilter = (
  props: DataTableHeaderPopupFilterProps,
) => {
  const { tr } = useI18n();
  const model = useDataTableFilterModel(props.form);
  const min = props.fields.find((field) => field.range === "min");
  const max = props.fields.find((field) => field.range === "max");
  const held = props.fields.some((field) => model.holds(field));

  const body = (() => {
    if (min || max) {
      return (
        <div className="flex gap-2 p-1">
          {min && (
            <DataTableHeaderPopupRange
              form={props.form}
              field={min}
              end="min"
            />
          )}
          {max && (
            <DataTableHeaderPopupRange
              form={props.form}
              field={max}
              end="max"
            />
          )}
        </div>
      );
    }
    const field = props.fields[0]!;
    const kind = model.kindOf(field);
    const items = model.itemsOf(field);
    if (kind === "list" && items) {
      return (
        <DataTableHeaderPopupList
          form={props.form}
          field={field}
          items={items}
        />
      );
    }
    if (kind === "text") {
      const label = model.labelOf(field);
      return (
        <div className="p-1">
          <Input
            data-slot="input"
            aria-label={label}
            placeholder={tr("dataTable.contains", { default: "Contains" })}
            value={dataTableFilterText(model.values[field.key])}
            onChange={(event) =>
              model.inputs[field.key]?.set(event.target.value || undefined)
            }
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- the reader just opened this popup to type into its one box
            autoFocus
          />
        </div>
      );
    }
    return (
      <div className="p-1">
        <Control {...model.controlPropsOf(field)} />
      </div>
    );
  })();

  return (
    <>
      {body}
      <div className="p-1">
        <Button
          type="button"
          size="sm"
          variant="outlined"
          className="w-full"
          disabled={!held}
          onClick={() => {
            for (const field of props.fields) model.clearField(field);
          }}
        >
          {tr("dataTable.resetFilter", { default: "Reset" })}
        </Button>
      </div>
    </>
  );
};
