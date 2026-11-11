import type { JobExecutionResource, JobStepView } from "alepha/api/jobs";
import { useI18n } from "alepha/react/i18n";

import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "../core/Collapsible.tsx";
import { AdminJobsPayloadBody } from "./AdminJobsPayloadBody.tsx";

export interface AdminJobExecutionStepsProps {
  /**
   * The run's timeline, as `getExecution` returns it: ordered, each result
   * a preview. Nothing is drawn when it is empty or absent.
   */
  steps?: JobStepView[];
  /**
   * The run's status: a run that is `scheduled` and whose last entry is a
   * sleep is waiting in that sleep.
   */
  status: JobExecutionResource["status"];
  /**
   * The run's error. The step that failed wrote nothing, so a failed run
   * shows it under the last step it completed.
   */
  error?: string;
}

/**
 * The steps of one execution, one row each: name, when it completed, how
 * long it ran, and its result behind a disclosure. A sleep says until when
 * it waited, or waits; a failed run says after which step it stopped.
 *
 * Presentational: the execution sheet reads the execution and passes its
 * steps, status and error.
 */
export const AdminJobExecutionSteps = (props: AdminJobExecutionStepsProps) => {
  const { l, tr } = useI18n();
  const steps = props.steps ?? [];
  if (steps.length === 0) return null;

  const last = steps[steps.length - 1];
  const sleeping =
    props.status === "scheduled" && last.until !== undefined
      ? last.name
      : undefined;

  return (
    <ol
      className="flex flex-col gap-2"
      aria-label={tr("admin.jobs.stepsTitle", { default: "Steps" })}
    >
      {steps.map((step) => (
        <li
          key={step.name}
          data-step={step.name}
          className="flex flex-col gap-1 rounded-md border px-3 py-2 text-sm"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <span className="font-mono font-medium">{step.name}</span>
            <span className="text-muted-foreground text-xs">
              {l(step.at, { date: "lll" })}
              {step.until === undefined ? ` · ${formatMs(step.ms)}` : ""}
            </span>
          </div>
          {step.until !== undefined &&
            (step.name === sleeping ? (
              <p className="text-sm">
                {tr("admin.jobs.stepWaitingUntil", {
                  args: {
                    time: l(step.until, { date: "lll" }),
                    relative: l(step.until, { date: "fromNow" }),
                  },
                  default: "Waiting until {time} ({relative})",
                })}
              </p>
            ) : (
              <p className="text-muted-foreground text-sm">
                {tr("admin.jobs.stepSleptUntil", {
                  args: { time: l(step.until, { date: "lll" }) },
                  default: "Slept until {time}",
                })}
              </p>
            ))}
          {step.resultPreview !== undefined && (
            <Collapsible>
              <CollapsibleTrigger chevron className="text-muted-foreground">
                {tr("admin.jobs.stepResult", { default: "Result" })}
              </CollapsibleTrigger>
              <CollapsiblePanel>
                <div className="pt-2">
                  <AdminJobsPayloadBody payload={parsePreview(step)} />
                </div>
              </CollapsiblePanel>
            </Collapsible>
          )}
        </li>
      ))}
      {props.status === "error" && props.error && (
        <li
          data-step-failure
          className="bg-danger/5 text-danger-text flex flex-col gap-1 rounded-md px-3 py-2 text-sm"
        >
          <span className="font-medium">
            {tr("admin.jobs.stepFailedAfter", {
              args: { name: last.name },
              default: "Failed after {name}",
            })}
          </span>
          <pre className="font-mono text-xs whitespace-pre-wrap">
            {props.error}
          </pre>
        </li>
      )}
    </ol>
  );
};

/**
 * A step's duration, in milliseconds under a second and in seconds above.
 */
const formatMs = (ms: number): string =>
  ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;

/**
 * The preview back as a value, so the payload body prints it the same way.
 * A preview cut at its cap is no longer JSON and is shown as the text it is.
 */
const parsePreview = (step: JobStepView): unknown => {
  try {
    return JSON.parse(step.resultPreview ?? "null");
  } catch {
    return step.resultPreview;
  }
};
