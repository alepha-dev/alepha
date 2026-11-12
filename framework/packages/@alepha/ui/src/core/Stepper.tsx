import { Check } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "./utils.ts";

/** One step of a {@link Stepper}. */
export interface StepperStep {
  /** Unique among the steps. */
  key: string;
  label: ReactNode;
  /** A short line under the label. */
  description?: ReactNode;
}

/** Where a step stands against the current one. */
export type StepperStepState = "done" | "current" | "upcoming";

export interface StepperProps {
  steps: StepperStep[];
  /** The index of the step on screen. */
  current: number;
  /**
   * Called with a step's index when it is clicked. Only the steps already
   * done are clickable: going forward is the caller's to validate.
   */
  onStepClick?: (index: number) => void;
  /** The list's accessible name. Defaults to "Steps". */
  label?: string;
  className?: string;
}

/** The state of the step at `index` when `current` is on screen. */
export const stepperStepState = (
  index: number,
  current: number,
): StepperStepState =>
  index < current ? "done" : index === current ? "current" : "upcoming";

/**
 * The header of a multi-step form: each step numbered, with its state drawn
 * (a check once done, the current one highlighted, the ones to come muted)
 * and joined by a line that fills as the steps are done.
 *
 * It draws the steps and nothing else: the body and the Back / Next buttons
 * stay the caller's, which is where validating a step belongs.
 */
export const Stepper = (props: StepperProps) => (
  <ol
    data-slot="stepper"
    aria-label={props.label ?? "Steps"}
    className={cn("flex w-full items-start gap-2", props.className)}
  >
    {props.steps.map((step, index) => {
      const state = stepperStepState(index, props.current);
      const clickable = state === "done" && Boolean(props.onStepClick);
      const last = index === props.steps.length - 1;
      return (
        <li
          key={step.key}
          data-state={state}
          aria-current={state === "current" ? "step" : undefined}
          className={cn(
            "flex min-w-0 flex-1 items-start gap-2",
            last && "flex-none",
          )}
        >
          <button
            type="button"
            disabled={!clickable}
            onClick={clickable ? () => props.onStepClick?.(index) : undefined}
            className={cn(
              "flex min-w-0 items-start gap-2 text-start",
              clickable && "cursor-pointer",
              !clickable && "cursor-default",
            )}
          >
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums transition-colors",
                state === "done" &&
                  "bg-primary border-primary text-primary-foreground",
                state === "current" &&
                  "border-primary text-primary ring-primary/20 ring-4",
                state === "upcoming" && "text-muted-foreground",
              )}
            >
              {state === "done" ? <Check className="size-3.5" /> : index + 1}
            </span>
            <span className="flex min-w-0 flex-col pt-1">
              <span
                className={cn(
                  "truncate text-sm font-medium",
                  state === "upcoming" && "text-muted-foreground",
                )}
              >
                {step.label}
              </span>
              {step.description && (
                <span className="text-muted-foreground truncate text-xs">
                  {step.description}
                </span>
              )}
            </span>
          </button>
          {!last && (
            <span
              aria-hidden
              className={cn(
                "mt-3.5 h-px min-w-4 flex-1",
                state === "done" ? "bg-primary" : "bg-border",
              )}
            />
          )}
        </li>
      );
    })}
  </ol>
);
