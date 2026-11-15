import { type ZObject, z } from "alepha";
import type { FormModel } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import { Input } from "../core/Input.tsx";
import type { DataTableFilterBarField } from "./DataTableFilterBar.tsx";
import { dataTableFilterText } from "./dataTableFilterText.ts";
import { useDataTableFilterModel } from "./useDataTableFilterModel.tsx";

/**
 * One end of an open range: a date box for a `z.date()`, a number box
 * otherwise, in units for a `cents` field.
 */
export interface DataTableHeaderPopupRangeProps {
  form: FormModel<ZObject>;
  field: DataTableFilterBarField;
  end: "min" | "max";
}

export const DataTableHeaderPopupRange = (
  props: DataTableHeaderPopupRangeProps,
) => {
  const { tr } = useI18n();
  const model = useDataTableFilterModel(props.form);
  const { field } = props;
  const schema = field.schema ? z.schema.unwrap(field.schema) : undefined;
  const date = schema !== undefined && z.schema.isDate(schema);
  const raw = model.values[field.key];
  const label =
    props.end === "min"
      ? tr("dataTable.rangeMin", { default: "Min" })
      : tr("dataTable.rangeMax", { default: "Max" });

  const shown =
    field.cents && typeof raw === "number"
      ? String(raw / 100)
      : dataTableFilterText(raw);

  // What the box holds is the reader's text, not the filter's value: a
  // number box half typed (« 12, ») has no value yet and must not be redrawn
  // from one. Read back from the filter only when the value changes under
  // it, as « Reset » does.
  const parse = (text: string): unknown => {
    if (text === "") return undefined;
    if (date) return text;
    const n = Number(text.replace(",", "."));
    if (!Number.isFinite(n)) return Number.NaN;
    return field.cents ? Math.round(n * 100) : n;
  };
  // The value the draft was typed for: when the filter's value moves away
  // from it, the draft is redrawn from the value, during render (React's
  // "adjusting state when a prop changes"), never from an effect.
  const [draft, setDraft] = useState({ text: shown, raw });
  if (draft.raw !== raw) setDraft({ text: shown, raw });

  const onChange = (next: string) => {
    const value = parse(next);
    if (typeof value === "number" && Number.isNaN(value)) {
      setDraft({ text: next, raw });
      return;
    }
    setDraft({ text: next, raw: value });
    model.inputs[field.key]?.set(value);
  };

  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Input
        data-header-range={props.end}
        aria-label={`${model.labelOf(field)} ${label}`}
        type={date ? "date" : "number"}
        inputMode={date ? undefined : "decimal"}
        step={field.cents ? "0.01" : "any"}
        value={draft.text}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
};
