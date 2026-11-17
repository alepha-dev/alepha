import { Badge, cn } from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";
import { ArrowRight, ChevronDown, type LucideIcon, Zap } from "lucide-react";
import type { ReactNode } from "react";

import type { I18n } from "../../../../services/I18n.ts";
import { AutomationOutlineTones } from "./AutomationOutlineTones.ts";

export interface AutomationOutlineFoldedProps {
  /**
   * What starts the block, its events joined.
   */
  event: string;
  eventIcon?: LucideIcon;
  /**
   * Under the event: the condition, or the event's filter.
   */
  detail?: ReactNode;
  /**
   * The first action's label; absent, the block does nothing yet.
   */
  action?: string;
  actionIcon?: LucideIcon;
  actionSummary?: ReactNode;
  /**
   * How many actions follow the first one.
   */
  more: number;
  /**
   * At the end: a switch.
   */
  trailing?: ReactNode;
  /**
   * Unfolds the block; absent, the line is only shown (a gallery card).
   */
  onUnfold?: () => void;
  testId?: string;
}

/**
 * A block folded into one line (#Q3847): its event, an arrow, its first
 * action and how many follow. The same line a preset card shows (#Q3851).
 */
const AutomationOutlineFolded = (props: AutomationOutlineFoldedProps) => {
  const { tr } = useI18n<I18n, "en">();
  const EventIcon = props.eventIcon ?? Zap;
  const ActionIcon = props.actionIcon ?? Zap;
  const body = (
    <>
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-lg",
          AutomationOutlineTones.TONES.when.tile,
        )}
      >
        <EventIcon className="size-4" />
      </span>
      <span className="flex min-w-0 shrink flex-col sm:w-44 sm:shrink-0">
        <span className="truncate font-medium">{props.event}</span>
        {props.detail && (
          <span className="text-muted-foreground truncate text-sm">
            {props.detail}
          </span>
        )}
      </span>
      <ArrowRight className="text-muted-foreground size-4 shrink-0" />
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-lg",
          AutomationOutlineTones.TONES.do.tile,
        )}
      >
        <ActionIcon className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex flex-wrap items-center gap-2 font-medium">
          {props.action ?? tr("automation.outline.noAction")}
          {props.more > 0 && (
            <Badge variant="secondary">
              {tr("automation.outline.more", { args: [String(props.more)] })}
            </Badge>
          )}
        </span>
        {props.actionSummary && (
          <span className="text-muted-foreground min-w-0 truncate text-sm">
            {props.actionSummary}
          </span>
        )}
      </span>
    </>
  );
  return (
    <div
      className="border-s-primary hover:bg-hover flex items-center gap-3 border-s-4 py-2.5 ps-4 pe-4"
      data-testid={props.testId}
    >
      {props.onUnfold ? (
        <button
          type="button"
          aria-expanded={false}
          onClick={props.onUnfold}
          className="focus-visible:ring-ring flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-md text-start outline-none focus-visible:ring-2"
        >
          {body}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">{body}</div>
      )}
      {props.trailing}
      {props.onUnfold && (
        <ChevronDown className="text-muted-foreground size-4 shrink-0" />
      )}
    </div>
  );
};

export default AutomationOutlineFolded;
