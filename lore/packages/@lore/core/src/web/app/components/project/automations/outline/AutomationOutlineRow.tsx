import { cn } from "@alepha/ui";
import { ChevronDown, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import {
  type AutomationOutlineTone,
  AutomationOutlineTones,
} from "./AutomationOutlineTones.ts";

export interface AutomationOutlineRowProps {
  tone: AutomationOutlineTone;
  icon: LucideIcon;
  /**
   * Before the icon: a sequence's number, or the mark of a step.
   */
  lead?: ReactNode;
  /**
   * How far a step sits under the first action of its sequence.
   */
  depth?: number;
  title: ReactNode;
  summary?: ReactNode;
  /**
   * At the end of the row: a switch, a badge.
   */
  trailing?: ReactNode;
  open?: boolean;
  onToggle?: () => void;
  /**
   * What the row opens into, in place.
   */
  children?: ReactNode;
  testId?: string;
}

/**
 * One row of the outline (#Q3847): an event, a condition or an action, its
 * label and a one-line summary; a click opens it in place.
 */
const AutomationOutlineRow = (props: AutomationOutlineRowProps) => {
  const Icon = props.icon;
  return (
    <div data-testid={props.testId} data-open={props.open || undefined}>
      <div
        className={cn(
          "flex items-center gap-3 py-2.5 pe-4",
          props.onToggle && "hover:bg-hover",
          props.open && "bg-hover",
        )}
        style={{ paddingInlineStart: `${1 + (props.depth ?? 0) * 2.25}rem` }}
      >
        <button
          type="button"
          disabled={!props.onToggle}
          aria-expanded={props.onToggle ? !!props.open : undefined}
          onClick={props.onToggle}
          className="focus-visible:ring-ring flex min-w-0 flex-1 items-center gap-3 rounded-md text-start outline-none focus-visible:ring-2 enabled:cursor-pointer"
        >
          {props.lead}
          <span
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-lg",
              AutomationOutlineTones.TONES[props.tone].tile,
            )}
          >
            <Icon className="size-4" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-foreground font-medium">{props.title}</span>
            {props.summary && (
              <span className="text-muted-foreground min-w-0 text-sm">
                {props.summary}
              </span>
            )}
          </span>
        </button>
        {props.trailing}
        {props.onToggle && (
          <ChevronDown
            className={cn(
              "text-muted-foreground size-4 shrink-0 transition-transform",
              props.open && "rotate-180",
            )}
          />
        )}
      </div>
      {props.open && props.children}
    </div>
  );
};

export default AutomationOutlineRow;
