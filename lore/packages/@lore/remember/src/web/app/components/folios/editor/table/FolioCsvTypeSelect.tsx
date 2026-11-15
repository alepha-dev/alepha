import { Control } from "@alepha/ui/form";
import type { I18n } from "@lore/core/web";
import { z } from "alepha";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import type { ReactElement } from "react";

/**
 * The types a CSV column can be imported as.
 */
export type FolioCsvGuessedType = "text" | "number" | "date" | "checkbox";

export interface FolioCsvTypeSelectProps {
  value: FolioCsvGuessedType;
  choices: FolioCsvGuessedType[];
  label: string;
  onChange: (type: FolioCsvGuessedType) => void;
}

/**
 * The type a preview column is imported as: a one-field form over a
 * `Control` select, which the person may change before importing.
 */
const FolioCsvTypeSelect = (props: FolioCsvTypeSelectProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const form = useForm({
    schema: z.object({ type: z.enum(["text", "number", "date", "checkbox"]) }),
    initialValues: { type: props.value },
    keepDirty: false,
    handler: async () => {},
    onChange: (_key, next) => props.onChange(next as FolioCsvGuessedType),
  });
  return (
    <Control
      input={form.input.type}
      label=""
      inputProps={{ "aria-label": props.label }}
      triggerClassName="h-7 text-xs"
      items={props.choices.map((type) => ({
        value: type,
        label: tr(`folios.table.type.${type}`),
      }))}
    />
  );
};

export default FolioCsvTypeSelect;
