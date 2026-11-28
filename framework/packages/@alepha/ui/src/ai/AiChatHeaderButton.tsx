import { Button, type ButtonProps } from "../core/Button.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../core/Tooltip.tsx";

export interface AiChatHeaderButtonProps extends Omit<
  ButtonProps,
  "size" | "variant" | "aria-label"
> {
  /**
   * What the button does: its accessible name and its tooltip.
   */
  label: string;
}

/**
 * An icon button of the panel's header, named by a tooltip as an app
 * header's icon buttons are, and by `aria-label` for a screen reader. For
 * an app's own `headerActions`, so they read like the panel's.
 */
export const AiChatHeaderButton = (props: AiChatHeaderButtonProps) => {
  const { label, ...rest } = props;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-sm"
            variant="minimal"
            aria-label={label}
            {...rest}
          />
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
};
