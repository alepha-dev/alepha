import * as React from "react";

void React;

import { AdminJobsStatusBadge } from "@alepha/ui/components/admin/admin-jobs-status-badge";
import { useConfirmedAction } from "@alepha/ui/components/admin/use-confirmed-action";
import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { FilterSlot } from "@alepha/ui/components/filter-slot/filter-slot";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { type Infer, z } from "alepha";
import type { AdminJobController, JobExecutionRow } from "alepha/api/jobs";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import {
  Ban,
  CircleDot,
  Eye,
  KeyRound,
  RotateCcw,
  Trash2,
  Workflow,
} from "lucide-react";
import { useCallback } from "react";

import TimeAgo from "../time-ago/time-ago.tsx";
import {
  JOB_EXECUTION_STATUSES,
  useJobStatusLabels,
} from "./admin-jobs-status-labels.ts";

export interface AdminJobDetailExecutionsProps {
  jobName: string;
  /**
   * Open the execution drawer on a row.
   */
  onOpen: (execution: JobExecutionRow) => void;
}

const EXEC_POLL_MS = 10_000;

const executionFiltersSchema = z.object({
  status: z.array(z.string()).optional(),
  trigger: z.string().optional(),
  startedAt: z.dateRange().optional(),
  key: z.string().optional(),
});
type ExecutionFilters = Infer<typeof executionFiltersSchema>;

/**
 * A job's executions, paged, sorted and filtered by the server.
 *
 * Every row action checks both the row (`can.retry`, `can.cancel`,
 * `can.delete`, from its status) and the caller (the action's own `can()`,
 * from their permissions): a finished row offered to someone who may not
 * delete it would only answer 403.
 */
export const AdminJobDetailExecutions = (
  props: AdminJobDetailExecutionsProps,
) => {
  const client = useClient<AdminJobController>();
  const { tr } = useI18n();
  const toast = useToast();
  const statusLabels = useJobStatusLabels();
  const jobName = props.jobName;

  const fetcher = useCallback(
    async (params: {
      page: number;
      size: number;
      sort?: string;
      filters?: ExecutionFilters;
    }) => {
      const f = params.filters;
      const status = (f?.status ?? []).filter((value) =>
        (JOB_EXECUTION_STATUSES as string[]).includes(value),
      ) as JobExecutionRow["status"][];
      const trigger =
        f?.trigger === "scheduled" ||
        f?.trigger === "manual" ||
        f?.trigger === "code"
          ? f.trigger
          : undefined;
      return client.listExecutions({
        params: { name: jobName },
        query: {
          page: params.page,
          size: params.size,
          sort: params.sort as never,
          ...(status.length > 0 ? { status } : {}),
          ...(trigger ? { trigger } : {}),
          ...(f?.key ? { key: f.key } : {}),
          // A day resolved to an instant, in UTC, the way the audit log
          // reads its range: a shared link selects the same rows for
          // everyone, and the end runs to the last millisecond of its day.
          ...(f?.startedAt?.length === 2
            ? {
                from: `${f.startedAt[0]}T00:00:00.000Z`,
                to: `${f.startedAt[1]}T23:59:59.999Z`,
              }
            : {}),
        },
      });
    },
    [client, jobName],
  );

  const retry = useConfirmedAction<[JobExecutionRow, () => void]>(
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

  const cancel = useConfirmedAction<[JobExecutionRow, () => void]>(
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

  const remove = useConfirmedAction<[JobExecutionRow, () => void]>(
    {
      confirm: {
        title: tr("admin.jobs.deleteTitle", { default: "Delete execution" }),
        description: tr("admin.jobs.deleteConfirm", {
          default:
            "Permanently delete this execution, its logs and its payload? This cannot be undone.",
        }),
        destructive: true,
      },
      handler: async (e, refresh) => {
        await client.deleteExecution({ params: { id: e.id } });
        refresh();
      },
      success: tr("admin.jobs.deleted", { default: "Execution deleted" }),
    },
    [client, tr],
  );

  const bulkRemove = useConfirmedAction<
    [JobExecutionRow[], { clearSelection: () => void; refresh: () => void }]
  >(
    {
      confirm: (items) => ({
        title: tr("admin.jobs.bulkDeleteTitle", {
          default: "Delete executions",
        }),
        description: tr("admin.jobs.bulkDeleteConfirm", {
          default: `Permanently delete ${items.length} execution(s)? Runs that have not finished are skipped. This cannot be undone.`,
          args: [String(items.length)],
        }),
        destructive: true,
      }),
      handler: async (items, { clearSelection, refresh }) => {
        if (items.length === 0) return;
        const res = await client.deleteExecutions({
          body: { ids: items.map((e) => e.id) },
        });
        toast.success(
          tr("admin.jobs.bulkDeleted", {
            default: `${res.deleted} deleted, ${res.skipped} skipped`,
            args: [String(res.deleted), String(res.skipped)],
          }),
        );
        clearSelection();
        refresh();
      },
    },
    [client, toast, tr],
  );

  const canRetry = client.retryExecution.can();
  const canCancel = client.cancelExecution.can();
  const canDelete = client.deleteExecution.can();
  const canBulkDelete = client.deleteExecutions.can();

  return (
    <AlephaTable<JobExecutionRow>
      className="min-h-0 flex-1"
      persistenceKey={`admin.jobs.detail.${jobName}`}
      pollMs={EXEC_POLL_MS}
      rowKey={(e) => e.id}
      fetch={fetcher}
      onRowClick={(e) => props.onOpen(e)}
      filters={{
        schema: executionFiltersSchema,
        render: (form) => (
          <div className="flex flex-wrap items-center gap-2">
            <FilterSlot>
              <Control
                input={form.input.key}
                label=""
                icon={KeyRound}
                placeholder={String(
                  tr("admin.jobs.keyFilter", { default: "Key" }),
                )}
                inputProps={{
                  "aria-label": String(
                    tr("admin.jobs.keyFilter", { default: "Key" }),
                  ),
                }}
              />
            </FilterSlot>
            <Control
              input={form.input.status}
              label=""
              clearable
              icon={CircleDot}
              triggerClassName="w-48"
              placeholder={String(
                tr("admin.jobs.statusAll", { default: "All statuses" }),
              )}
              items={JOB_EXECUTION_STATUSES.map((status) => ({
                value: status,
                label: statusLabels[status],
              }))}
            />
            <Control
              input={form.input.trigger}
              label=""
              clearable
              icon={Workflow}
              clearLabel={String(
                tr("admin.jobs.triggerAll", { default: "Any trigger" }),
              )}
              triggerClassName="w-40"
              items={[
                {
                  value: "scheduled",
                  label: tr("admin.jobs.triggerScheduled", {
                    default: "Scheduled",
                  }),
                },
                {
                  value: "manual",
                  label: tr("admin.jobs.triggerManual", { default: "Manual" }),
                },
                {
                  value: "code",
                  label: tr("admin.jobs.triggerCode", { default: "Code" }),
                },
              ]}
            />
            {/* The calendar control selects itself off the schema's
                `date-range` format. */}
            <Control
              input={form.input.startedAt}
              label=""
              clearable
              triggerClassName="w-64"
              placeholder={String(
                tr("admin.jobs.startedAny", { default: "Started any time" }),
              )}
            />
          </div>
        ),
      }}
      columns={{
        status: {
          label: tr("admin.jobs.colStatus", { default: "Status" }),
          sortable: true,
          cell: (e) => <AdminJobsStatusBadge status={e.status} />,
        },
        createdAt: {
          label: tr("admin.jobs.colCreated", { default: "Created" }),
          sortable: true,
          cell: (e) => (
            <TimeAgo
              value={e.createdAt}
              className="text-muted-foreground text-xs"
            />
          ),
        },
        startedAt: {
          label: tr("admin.jobs.colStarted", { default: "Started" }),
          sortable: true,
          cell: (e) =>
            e.startedAt ? (
              <TimeAgo
                value={e.startedAt}
                className="text-muted-foreground text-xs"
              />
            ) : null,
        },
        completedAt: {
          label: tr("admin.jobs.colCompleted", { default: "Completed" }),
          sortable: true,
          cell: (e) =>
            e.completedAt ? (
              <TimeAgo
                value={e.completedAt}
                className="text-muted-foreground text-xs"
              />
            ) : null,
        },
        duration: {
          label: tr("admin.jobs.colDuration", { default: "Duration" }),
          align: "right",
          cell: (e) => {
            if (!e.startedAt || !e.completedAt) return null;
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
          sortable: true,
          cell: (e) => (
            <span className="text-xs">
              {e.attempt}/{e.maxAttempts}
            </span>
          ),
        },
        key: {
          label: tr("admin.jobs.colKey", { default: "Key" }),
          cell: (e) =>
            e.key ? <span className="font-mono text-xs">{e.key}</span> : null,
        },
        triggeredBy: {
          label: tr("admin.jobs.colTriggeredBy", { default: "Triggered by" }),
          cell: (e) =>
            e.triggeredByName || e.triggeredBy ? (
              <span className="text-muted-foreground text-xs">
                {e.triggeredByName ?? e.triggeredBy}
              </span>
            ) : null,
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
            ) : null,
        },
      }}
      rowActions={(e) => [
        {
          label: tr("admin.jobs.view", { default: "View" }),
          icon: Eye,
          onClick: () => props.onOpen(e),
        },
        ...(e.can.retry && canRetry
          ? [
              {
                label: tr("admin.jobs.retry", { default: "Retry" }),
                icon: RotateCcw,
                onClick: (_e: JobExecutionRow, ctx: { refresh: () => void }) =>
                  retry.run(e, ctx.refresh),
              },
            ]
          : []),
        ...(e.can.cancel && canCancel
          ? [
              {
                label: tr("admin.jobs.cancel", { default: "Cancel" }),
                icon: Ban,
                destructive: true,
                onClick: (_e: JobExecutionRow, ctx: { refresh: () => void }) =>
                  cancel.run(e, ctx.refresh),
              },
            ]
          : []),
        ...(e.can.delete && canDelete
          ? [
              {
                label: tr("admin.jobs.delete", { default: "Delete" }),
                icon: Trash2,
                destructive: true,
                onClick: (_e: JobExecutionRow, ctx: { refresh: () => void }) =>
                  remove.run(e, ctx.refresh),
              },
            ]
          : []),
      ]}
      bulkActions={
        canBulkDelete
          ? [
              {
                label: tr("admin.jobs.bulkDelete", {
                  default: "Delete selected",
                }),
                icon: Trash2,
                destructive: true,
                onClick: (items, ctx) => bulkRemove.run(items, ctx),
              },
            ]
          : undefined
      }
      emptyMessage={String(
        tr("admin.jobs.noExecs", { default: "No executions yet." }),
      )}
    />
  );
};
