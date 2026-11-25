import { Control } from "@alepha/ui/form";
import { z } from "alepha";
import { useForm } from "alepha/react/form";

export interface PromptEnabledCellProps {
  enabled: boolean;
  disabled: boolean;
  label: string;
  onChange: (enabled: boolean) => void;
}

/**
 * A prompt's trigger switch in its row (#Q4280): a one-field form whose
 * change is the write. `keepDirty: false`, so a refused write leaves the
 * switch where the row says.
 */
const PromptEnabledCell = (props: PromptEnabledCellProps) => {
  const form = useForm({
    schema: z.object({ enabled: z.boolean() }),
    initialValues: { enabled: props.enabled },
    keepDirty: false,
    handler: async () => {},
    onChange: (_key, next) => props.onChange(next as boolean),
  });
  return (
    <span data-testid="prompt-enabled">
      <Control
        input={form.input.enabled}
        aria-label={props.label}
        switch
        disabled={props.disabled}
      />
    </span>
  );
};

export default PromptEnabledCell;
