import { cn } from "@alepha/ui";
import type { ReactNode } from "react";

import {
  type AutomationOutlineTone,
  AutomationOutlineTones,
} from "./AutomationOutlineTones.ts";

export interface AutomationOutlineSectionProps {
  tone: AutomationOutlineTone;
  label: string;
  hint?: string;
  /**
   * What sits at the end of the section's band: its buttons.
   */
  action?: ReactNode;
  /**
   * A side a run did not take: shown, dimmed.
   */
  dim?: boolean;
  children?: ReactNode;
  testId?: string;
}

/**
 * One section of a block (#Q3847): When, Only if, Then (Do) or Otherwise,
 * a coloured rail down its side and a solid label in its band.
 */
const AutomationOutlineSection = (props: AutomationOutlineSectionProps) => {
  const tone = AutomationOutlineTones.TONES[props.tone];
  return (
    <section
      className={cn("border-s-4", tone.rail, props.dim && "opacity-50")}
      data-testid={props.testId}
      data-dim={props.dim || undefined}
    >
      <header
        className={cn("flex min-h-9 items-center gap-2 px-4 py-1.5", tone.band)}
      >
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[0.7rem] font-bold tracking-wider uppercase",
            tone.label,
          )}
        >
          {props.label}
        </span>
        {props.hint && (
          <span className="text-muted-foreground text-xs">{props.hint}</span>
        )}
        <div className="flex-1" />
        {props.action}
      </header>
      <div className="divide-y">{props.children}</div>
    </section>
  );
};

export default AutomationOutlineSection;
