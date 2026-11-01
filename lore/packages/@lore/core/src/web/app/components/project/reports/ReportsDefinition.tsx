import { Tooltip, TooltipContent, TooltipTrigger } from "@alepha/ui";
import { Info } from "lucide-react";

export interface ReportsDefinitionProps {
  /**
   * What is counted and what it divides by.
   */
  text: string;
}

/**
 * The small info mark beside a figure (#Q2997): a number with no definition is
 * how a reader adds overlapping tag bars and finds more quests than exist.
 */
const ReportsDefinition = (props: ReportsDefinitionProps) => {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={props.text}
            className="text-muted-foreground/70 hover:text-foreground inline-flex"
          />
        }
      >
        <Info className="size-3" />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{props.text}</TooltipContent>
    </Tooltip>
  );
};

export default ReportsDefinition;
