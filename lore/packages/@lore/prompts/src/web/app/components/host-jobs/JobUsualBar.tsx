import type { HostJobResource } from "@lore/core/schemas";
import type { I18n } from "@lore/core/web";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

export interface JobUsualBarProps {
  /**
   * How long the last runs of the same prompt text took (#Q4435).
   */
  usual: NonNullable<HostJobResource["usual"]>;
  startedAt: string;
}

/**
 * A running job with no steps (a triage, a feedback run, an epic review),
 * timed against the last runs of the same prompt text (#Q4435, epic
 * #E181): a bar that reaches 90% at their 90th percentile and holds there,
 * never full while the job runs, and "usually 1 to 2 min" beside it, from
 * their middle half.
 */
const JobUsualBar = (props: JobUsualBarProps) => {
  const { tr } = useI18n<I18n, "en">();
  const dateTime = useInject(DateTimeProvider);
  const elapsed = Math.max(
    0,
    (dateTime.nowMillis() - Date.parse(props.startedAt)) / 1000,
  );
  const ceiling = Math.max(1, props.usual.p90);
  const fill = elapsed >= ceiling ? 0.9 : (0.9 * elapsed) / ceiling;
  return (
    <div className="flex flex-col gap-1" data-testid="job-usual">
      <div
        className="bg-foreground/10 relative h-2 w-full overflow-hidden rounded-sm"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fill * 100)}
        aria-label={tr("jobs.usual.aria")}
      >
        <span
          className="bg-primary absolute inset-y-0 left-0 rounded-sm transition-[width]"
          style={{ width: `${Math.round(fill * 100)}%` }}
          data-testid="job-usual-fill"
        />
      </div>
      <span
        className="text-muted-foreground text-xs tabular-nums"
        data-testid="job-usual-text"
      >
        {tr("jobs.usual.text", {
          args: [minutesText(props.usual.low), minutesText(props.usual.high)],
        })}
      </span>
    </div>
  );
};

/**
 * `1 min`, under a minute `45 s`, `1.5 min` kept to one decimal.
 */
const minutesText = (seconds: number): string => {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} s`;
  const minutes = Math.round((seconds / 60) * 10) / 10;
  return `${minutes} min`;
};

export default JobUsualBar;
