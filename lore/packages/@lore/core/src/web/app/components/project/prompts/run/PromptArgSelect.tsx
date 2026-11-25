import { Control } from "@alepha/ui/form";

export interface PromptArgSelectProps {
  input: never;
  label: string;
  items: Array<{ value: string; label: string }>;
  disabled?: boolean;
}

/**
 * One arg's select (#Q4280): the items it accepts, by reference and title.
 * Never a free-text field.
 */
const PromptArgSelect = (props: PromptArgSelectProps) => (
  <Control
    input={props.input}
    label={props.label}
    select
    items={props.items}
    disabled={props.disabled}
  />
);

export default PromptArgSelect;
