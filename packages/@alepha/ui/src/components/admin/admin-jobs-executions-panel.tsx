import { AdminJobsPayloadDialog } from "@alepha/ui/components/admin/admin-jobs-payload-dialog";
import { AdminJobsStatusBadge } from "@alepha/ui/components/admin/admin-jobs-status-badge";
import { useConfirmedAction } from "@alepha/ui/components/admin/use-confirmed-action";
import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { type Infer, type Page, z } from "alepha";
import type { AdminJobController, JobExecutionResource } from "alepha/api/jobs";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Ban, Braces, CircleDot, RotateCcw } from "lucide-react";
import { useCallback, useState } from "react";

import {
  JOB_EXECUTION_STATUSES,
  useJobStatusLabels,
} from "./admin-jobs-status-labels.ts";

const EXEC_POLL_MS = 10_000;

const execFiltersSchema = z.object({
  status: z.string().optional(),
});
type ExecFilters = Infer<typeof execFiltersSchema>;

/**
 * Wrap an in-memory array as a `Page<T>` so it can feed `AlephaTable`'s fetcher
 * without server-side pagination (the executions endpoint returns a bounded
 * window).
 */
function asPage<T>(items: T[]): Page<T> {
  return {
    content: items,
    page: {
      number: 0,
      size: items.length,
      offset: 0,
      numberOfElements: items.length,
      totalElements: items.length,
      totalPages: 1,
      isEmpty: items.length === 0,
      isFirst: true,
      isLast: true,
    },
  };
}

export interface AdminJobsExecutionsPanelProps {
  jobName: string;
}

/**
 * Executions table for a single job — a polling `AlephaTable` of
 * `JobExecutionResource` with status filter and retry/cancel row actions
 * (gated server-side via `e.can.*`). Self-contained: resolves its own client,
 * i18n and dialogs rather than receiving them as props.
 */
export const AdminJobsExecutionsPanel = (
  props: AdminJobsExecutionsPanelProps,
) => {
  const { jobName } = props;
  const client = useClient<AdminJobController>();
  const { l, tr } = useI18n();
  const statusLabels = useJobStatusLabels();
  const [payloadOf, setPayloadOf] = useState<JobExecutionResource | null>(null);

  const fetcher = useCallback(
    async (params: { filters?: ExecFilters }) => {
      const status = params.filters?.status as
        | "pending"
        | "running"
        | "scheduled"
        | "ok"
        | "error"
        | "cancelled"
        | undefined;
      const rows = await client.listExecutions({
        params: { name: jobName },
        query: status ? { status, limit: 100 } : { limit: 100 },
      });
      return asPage(rows as JobExecutionResource[]);
    },
    [client, jobName],
  );

  const retry = useConfirmedAction<[JobExecutionResource, () => void]>(
    {
      confirm: {
        title: tr("admin.jobs.retryTitle", { default: "Retry execution" }),
        description: tr("admin.jobs.retryConfirm", {
          default: "Re-queue this execution for another attempt?",
        }),
      },
      handler: async (e, refresh) => {
        await client.retryExecution({ params: { id: e.id } });
        refresh();
      },
      success: tr("admin.jobs.retried", { default: "Execution re-queued" }),
    },
    [client, tr],
  );

  const cancel = useConfirmedAction<[JobExecutionResource, () => void]>(
    {
      confirm: {
        title: tr("admin.jobs.cancelTitle", { default: "Cancel execution" }),
        description: tr("admin.jobs.cancelConfirm", {
          default: "Cancel this pending execution? It will not run.",
        }),
        destructive: true,
      },
      handler: async (e, refresh) => {
        await client.cancelExecution({ params: { id: e.id } });
        refresh();
      },
      success: tr("admin.jobs.cancelled", { default: "Execution cancelled" }),
    },
    [client, tr],
  );

  return (
    <>
      <AlephaTable<JobExecutionResource>
        className="min-h-0 flex-1"
        persistenceKey={`admin.jobs.executions.${jobName}`}
        pollMs={EXEC_POLL_MS}
        rowKey={(e) => e.id}
        fetch={fetcher}
        filters={{
          schema: execFiltersSchema,
          render: (form) => (
            <Control
              input={form.input.status}
              label=""
              clearable
              icon={CircleDot}
              clearLabel={String(
                tr("admin.jobs.statusAll", { default: "All statuses" }),
              )}
              triggerClassName="w-40"
              items={JOB_EXECUTION_STATUSES.map((status) => ({
                value: status,
                label: statusLabels[status],
              }))}
            />
          ),
        }}
        columns={{
          status: {
            label: tr("admin.jobs.colStatus", { default: "Status" }),
            cell: (e) => <AdminJobsStatusBadge status={e.status} />,
          },
          startedAt: {
            label: tr("admin.jobs.colStarted", { default: "Started" }),
            cell: (e) => (
              <span className="text-muted-foreground text-xs">
                {e.startedAt
                  ? String(l(e.startedAt, { date: "fromNow" }))
                  : tr("admin.jobs.notStarted", { default: "Not started" })}
              </span>
            ),
          },
          scheduledAt: {
            label: tr("admin.jobs.colScheduled", { default: "Scheduled" }),
            cell: (e) =>
              e.status === "scheduled" && e.scheduledAt ? (
                // A parked row: a retry waiting out its backoff, a delayed
                // push, or a job rescheduled onto its next stage.
                <span
                  className="text-muted-foreground text-xs"
                  title={String(l(e.scheduledAt, { date: "lll" }))}
                >
                  {String(l(e.scheduledAt, { date: "fromNow" }))}
                </span>
              ) : (
                <span className="text-muted-foreground">-</span>
              ),
          },
          duration: {
            label: tr("admin.jobs.colDuration", { default: "Duration" }),
            align: "right",
            cell: (e) => {
              if (!e.startedAt || !e.completedAt) {
                return <span className="text-muted-foreground">-</span>;
              }
              const ms =
                new Date(e.completedAt).getTime() -
                new Date(e.startedAt).getTime();
              return (
                <span className="text-xs">
                  {ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`}
                </span>
              );
            },
          },
          attempt: {
            label: tr("admin.jobs.colAttempt", { default: "Attempt" }),
            align: "right",
            cell: (e) => (
              <span className="text-xs">
                {e.attempt}/{e.maxAttempts}
              </span>
            ),
          },
          key: {
            label: tr("admin.jobs.colKey", { default: "Key" }),
            cell: (e) =>
              e.key ? (
                <span className="font-mono text-xs">{e.key}</span>
              ) : (
                // Terminal rows release their key, so only a live one shows.
                <span className="text-muted-foreground">-</span>
              ),
          },
          triggeredBy: {
            label: tr("admin.jobs.colTriggeredBy", { default: "Triggered by" }),
            cell: (e) => (
              <span className="text-muted-foreground text-xs">
                {e.triggeredByName ?? e.triggeredBy ?? "-"}
              </span>
            ),
          },
          error: {
            label: tr("admin.jobs.colError", { default: "Error" }),
            cell: (e) =>
              e.error ? (
                <span
                  className="text-destructive line-clamp-2 text-xs"
                  title={e.error}
                >
                  {e.error}
                </span>
              ) : (
                <span className="text-muted-foreground">-</span>
              ),
          },
        }}
        rowActions={(e) => {
          const actions = [] as Array<{
            label: string;
            icon: typeof RotateCcw;
            onClick: (
              _e: JobExecutionResource,
              ctx: { refresh: () => void },
            ) => void;
            destructive?: boolean;
          }>;
          actions.push({
            label: tr("admin.jobs.viewPayload", { default: "View payload" }),
            icon: Braces,
            onClick: () => setPayloadOf(e),
          });
          if (e.can.retry) {
            actions.push({
              label: tr("admin.jobs.retry", { default: "Retry" }),
              icon: RotateCcw,
              onClick: (_e, { refresh }) => retry.run(e, refresh),
            });
          }
          if (e.can.cancel) {
            actions.push({
              label: tr("admin.jobs.cancel", { default: "Cancel" }),
              icon: Ban,
              destructive: true,
              onClick: (_e, { refresh }) => cancel.run(e, refresh),
            });
          }
          return actions;
        }}
        emptyMessage={String(
          tr("admin.jobs.noExecs", { default: "No executions yet." }),
        )}
      />
      <AdminJobsPayloadDialog
        execution={payloadOf}
        onClose={() => setPayloadOf(null)}
      />
    </>
  );
};
