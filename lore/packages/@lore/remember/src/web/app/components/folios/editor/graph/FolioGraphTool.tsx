import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@alepha/ui";
import type { ReactNode } from "react";

export interface FolioGraphToolProps {
  label: string;
  testId?: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}

/**
 * One icon button of the graph's toolbar, its label as its tooltip.
 */
const FolioGraphTool = (props: FolioGraphToolProps) => (
  <Tooltip>
    <TooltipTrigger
      render={
        <Button
          type="button"
          variant="minimal"
          size="icon-xs"
          aria-label={props.label}
          aria-pressed={props.pressed}
          data-testid={props.testId}
          onClick={props.onClick}
        >
          {props.children}
        </Button>
      }
    />
    <TooltipContent>{props.label}</TooltipContent>
  </Tooltip>
);

export default FolioGraphTool;
