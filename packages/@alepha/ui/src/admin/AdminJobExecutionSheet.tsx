import * as React from "react";

void React;

import type { AdminJobController, JobExecutionResource } from "alepha/api/jobs";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useEffect, useState } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../core/Sheet.tsx";
import { Skeleton } from "../core/Skeleton.tsx";
import { AdminJobExecutionLogs } from "./AdminJobExecutionLogs.tsx";
import { AdminJobsPayloadBody } from "./AdminJobsPayloadBody.tsx";
import { AdminJobsStatusBadge } from "./AdminJobsStatusBadge.tsx";

export interface AdminJobExecutionSheetProps {
  /**
   * The execution to show, or `undefined` when the drawer is closed.
   */
  executionId?: string;
  onClose: () => void;
  /**
   * How often a run still in progress is read again, in milliseconds.
   *
   * @default 3000
   */
  pollMs?: number;
}

/**
 * One execution in a drawer: its overview, its error in full, its logs as
 * lines, and its payload.
 *
 * It reads `getExecution`, the one endpoint that returns the payload and the
 * logs a list row does not carry. While the run is pending, scheduled or
 * running it reads again every few seconds and stops at a terminal status;
 * nothing is written while a run is in progress, so until then the logs
 * section says they arrive when the run ends.
 */
export const AdminJobExecutionSheet = (props: AdminJobExecutionSheetProps) => {
  const client = useClient<AdminJobController>();
  const { l, tr } = useI18n();
  const [execution, setExecution] = useState<JobExecutionResource>();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const id = props.executionId;
    // oxlint-disable-next-line react/set-state-in-effect -- clears the previous execution before fetching the next id's
    setExecution(undefined);
    setMissing(false);
    if (!id) return;

    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const next = (await client.getExecution({
          params: { id },
        })) as JobExecutionResource;
        if (!live) return;
        setExecution(next);
        if (isInProgress(next.status)) {
          timer = setTimeout(read, props.pollMs ?? 3_000);
        }
      } catch {
        if (live) setMissing(true);
      }
    };
    void read();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [client, props.executionId, props.pollMs]);

  const inProgress = execution ? isInProgress(execution.status) : false;
  const date = (value?: string) =>
    value ? l(value, { date: "lll" }) : undefined;

  const overview: Array<[string, React.ReactNode]> = execution
    ? [
        [
          tr("admin.jobs.colStatus", { default: "Status" }),
          <AdminJobsStatusBadge key="status" status={execution.status} />,
        ],
        [
          tr("admin.jobs.colStarted", { default: "Started" }),
          date(execution.startedAt),
        ],
        [
          tr("admin.jobs.colCompleted", { default: "Completed" }),
          date(execution.completedAt),
        ],
        [
          tr("admin.jobs.colDuration", { default: "Duration" }),
          formatDuration(execution.startedAt, execution.completedAt),
        ],
        [
          tr("admin.jobs.colAttempt", { default: "Attempt" }),
          `${execution.attempt}/${execution.maxAttempts}`,
        ],
        [tr("admin.jobs.colKey", { default: "Key" }), execution.key],
        [
          tr("admin.jobs.colTriggeredBy", { default: "Triggered by" }),
          execution.triggeredByName ?? execution.triggeredBy,
        ],
        [
          tr("admin.jobs.colScheduled", { default: "Scheduled" }),
          date(execution.scheduledAt),
        ],
        [
          tr("admin.jobs.colRedispatches", { default: "Redispatches" }),
          execution.redispatchCount > 0
            ? String(execution.redispatchCount)
            : undefined,
        ],
      ]
    : [];

  return (
    <Sheet
      open={props.executionId !== undefined}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto data-[side=right]:sm:max-w-[40rem]"
      >
        <SheetHeader>
          <SheetTitle>
            {tr("admin.jobs.executionTitle", { default: "Execution" })}
          </SheetTitle>
          <SheetDescription className="font-mono text-xs">
            {props.executionId}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 p-4">
          {missing ? (
            <p className="text-muted-foreground text-sm">
              {tr("admin.jobs.executionMissing", {
                default: "This execution no longer exists.",
              })}
            </p>
          ) : !execution ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              <section className="flex flex-col gap-2">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                  {overview
                    .filter(([, value]) => value !== undefined && value !== "")
                    .map(([label, value]) => (
                      <React.Fragment key={label}>
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="min-w-0 break-words">{value}</dd>
                      </React.Fragment>
                    ))}
                </dl>
              </section>

              {execution.error && (
                <section className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">
                    {tr("admin.jobs.colError", { default: "Error" })}
                  </h3>
                  <pre className="bg-destructive/5 text-destructive overflow-x-auto rounded-md p-3 font-mono text-xs whitespace-pre-wrap">
                    {execution.error}
                  </pre>
                </section>
              )}

              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">
                  {tr("admin.jobs.logs", { default: "Logs" })}
                </h3>
                <AdminJobExecutionLogs
                  logs={execution.logs}
                  inProgress={inProgress}
                />
              </section>

              {execution.payload !== undefined && (
                <section className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">
                    {tr("admin.jobs.payloadTitle", { default: "Payload" })}
                  </h3>
                  <AdminJobsPayloadBody payload={execution.payload} />
                </section>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

/**
 * The statuses a run can still leave.
 */
const isInProgress = (status: JobExecutionResource["status"]): boolean =>
  status === "pending" || status === "running" || status === "scheduled";

/**
 * Wall-clock time between start and end, or nothing while either is missing.
 */
const formatDuration = (
  startedAt?: string,
  completedAt?: string,
): string | undefined => {
  if (!startedAt || !completedAt) return undefined;
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return undefined;
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
};
