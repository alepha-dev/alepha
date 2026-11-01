import { Control } from "@alepha/ui/form";
import type { BaseInputField } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import type { ReportsFilter } from "../../../registries/ReportsTabRegistry.ts";
import type { I18n } from "../../../services/I18n.ts";

export interface ReportsFilterSelectProps {
  filter: ReportsFilter;
  input: BaseInputField;
  disabled: boolean;
}

/**
 * One Work filter of the bar. A component of its own so that `useOptions`, a
 * hook, runs once per mounted filter and never in a loop.
 */
const ReportsFilterSelect = (props: ReportsFilterSelectProps) => {
  const { tr } = useI18n<I18n, "en">();
  const items = props.filter.useOptions();

  return (
    <Control
      input={props.input}
      label=""
      inputProps={{ "aria-label": tr(props.filter.labelKey as never) }}
      placeholder={tr(props.filter.labelKey as never)}
      clearable
      minimal
      size="xs"
      triggerClassName="w-auto"
      disabled={props.disabled}
      items={items}
    />
  );
};

export default ReportsFilterSelect;
