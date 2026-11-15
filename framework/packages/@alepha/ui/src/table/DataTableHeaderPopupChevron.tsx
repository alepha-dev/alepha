import type { ZObject } from "alepha";
import type { FormModel } from "alepha/react/form";
import { ChevronDown } from "lucide-react";

import { cn } from "../core/utils.ts";
import type { DataTableFilterBarField } from "./DataTableFilterBar.tsx";
import { useDataTableFilterModel } from "./useDataTableFilterModel.tsx";

/**
 * The chevron after the name: dim at rest, the accent colour while one of
 * the column's filters holds a value.
 */
export interface DataTableHeaderPopupChevronProps {
  form: FormModel<ZObject>;
  fields: DataTableFilterBarField[];
}

export const DataTableHeaderPopupChevron = (
  props: DataTableHeaderPopupChevronProps,
) => {
  const model = useDataTableFilterModel(props.form);
  const active = props.fields.some((field) => model.holds(field));
  return (
    <ChevronDown
      data-header-chevron=""
      data-active={active ? "" : undefined}
      className={cn(
        "size-3.5 shrink-0 transition-[opacity,color]",
        active ? "text-primary" : "text-muted-foreground opacity-60",
      )}
      aria-hidden
    />
  );
};
