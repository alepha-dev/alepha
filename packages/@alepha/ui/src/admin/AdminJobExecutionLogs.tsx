import type { LogEntry } from "alepha/logger";
import { useI18n } from "alepha/react/i18n";

import { cn } from "../core/utils.ts";

export interface AdminJobExecutionLogsProps {
  /**
   * The entries the run captured, as stored on its row.
   */
  logs?: LogEntry[];
  /**
   * Whether the run is still in progress. Nothing is written while a run is
   * running, so its logs are not there yet rather than empty.
   */
  inProgress: boolean;
}

/**
 * The log of one run as lines: level, time, message, and the data an entry
 * carried beneath it.
 *
 * Every terminal write stores the run's log snapshot, successes included,
 * TRACE and DEBUG entries included even when `LOG_LEVEL` hides them. Rows
 * written before that shipped carry logs only when they failed, which is why
 * an empty log on a finished run is said in one line rather than drawn as a
 * blank box.
 */
export const AdminJobExecutionLogs = (props: AdminJobExecutionLogsProps) => {
  const { l, tr } = useI18n();

  if (props.inProgress) {
    return (
      <p className="text-muted-foreground text-sm">
        {tr("admin.jobs.logsPending", {
          default: "The logs arrive when the run ends.",
        })}
      </p>
    );
  }

  const logs = props.logs ?? [];
  if (logs.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {tr("admin.jobs.logsEmpty", {
          default: "This run kept no log entries.",
        })}
      </p>
    );
  }

  return (
    <ol
      className="bg-muted flex max-h-[50vh] flex-col overflow-auto rounded-md p-2 font-mono text-xs leading-relaxed"
      aria-label={String(tr("admin.jobs.logs", { default: "Logs" }))}
    >
      {logs.map((entry, index) => (
        <li
          // A log entry has no id of its own; its time and its place do.
          key={`${entry.timestamp}:${index}`}
          className="flex flex-col gap-0.5 px-1 py-0.5"
          data-level={entry.level}
        >
          <div className="flex min-w-0 items-baseline gap-2">
            <span
              className={cn(
                "w-12 shrink-0 font-semibold",
                entry.level === "ERROR" && "text-destructive",
                entry.level === "WARN" && "text-amber-600 dark:text-amber-400",
                (entry.level === "DEBUG" || entry.level === "TRACE") &&
                  "text-muted-foreground",
              )}
            >
              {entry.level}
            </span>
            <span className="text-muted-foreground shrink-0">
              {String(l(entry.timestamp, { date: "HH:mm:ss" }))}
            </span>
            <span className="min-w-0 break-words whitespace-pre-wrap">
              {entry.message}
            </span>
          </div>
          {entry.data !== undefined && entry.data !== null && (
            <pre className="text-muted-foreground ml-14 overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(entry.data, null, 2)}
            </pre>
          )}
        </li>
      ))}
    </ol>
  );
};
