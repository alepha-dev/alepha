import { Control } from "@alepha/ui/form";
import { z } from "alepha";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import type { I18n } from "../../services/I18n.ts";

export interface DashboardFilterTextProps {
  name: string;
  value: string;
  onChange: (value: string) => void;
}

/**
 * A free-text filter, as a textarea: a note's markdown (#Q2659).
 *
 * A one-field `useForm`, because a field is always a `Control`: the draft
 * lives in the form, and every keystroke hands the catalogue the new value,
 * which saves with the card like any other filter.
 */
const DashboardFilterText = (props: DashboardFilterTextProps) => {
  const { tr } = useI18n<I18n, "en">();
  const form = useForm({
    schema: z.object({ value: z.text({ maxLength: 4000 }).optional() }),
    initialValues: { value: props.value },
    handler: async () => {},
    onChange: (_key, next) => props.onChange(String(next ?? "")),
  });

  return (
    <Control
      input={form.input.value}
      label=""
      area={props.name === "markdown"}
      rows={props.name === "markdown" ? 6 : undefined}
      placeholder={tr(
        props.name === "branch"
          ? "dashboard.filter.branchPlaceholder"
          : "dashboard.filter.markdownPlaceholder",
      )}
      inputProps={{
        "data-testid": `dashboard-filter-text-${props.name}`,
        "aria-label": tr(`dashboard.filterField.${props.name}` as never),
      }}
    />
  );
};

export default DashboardFilterText;
