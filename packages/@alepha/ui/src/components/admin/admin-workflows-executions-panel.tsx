import { WorkflowExecutionSheet } from "@alepha/ui/components/admin/admin-workflows-execution-sheet";
import { WorkflowStatusBadge } from "@alepha/ui/components/admin/admin-workflows-status-badge";
import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { type Infer, z } from "alepha";
import type {
  AdminWorkflowController,
  WorkflowExecutionResource,
} from "alepha/api/workflows";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { CircleDot } from "lucide-react";
import { useCallback, useState } from "react";

const EXEC_POLL_MS = 10_000;

const execFiltersSchema = z.object({
  status: z.string().optional(),
});
type ExecFilters = Infer<typeof execFiltersSchema>;

export interface WorkflowExecutionsPanelProps {
  workflowName: string;
}

/**
 * Server-paginated executions table for a single workflow. Row click opens
 * the execution detail sheet (step timeline + admin actions).
 */
export const WorkflowExecutionsPanel = (
  props: WorkflowExecutionsPanelProps,
) => {
  const client = useClient<AdminWorkflowController>();
  const { l, tr } = useI18n();
  const [openExecution, setOpenExecution] = useState<string | null>(null);

  const fetcher = useCallback(
    async (params: {
      page: number;
      size: number;
      sort?: string;
      filters?: ExecFilters;
    }) => {
      return client.findWorkflowExecutions({
        query: {
          page: params.page,
          size: params.size,
          sort: params.sort,
          workflow: props.workflowName,
          status: params.filters?.status as
            | WorkflowExecutionResource["status"]
            | undefined,
        },
      });
    },
    [client, props.workflowName],
  );

  return (
    <>
      <AlephaTable<WorkflowExecutionResource>
        className="min-h-0 flex-1"
        persistenceKey={`admin.workflows.executions.${props.workflowName}`}
        pollMs={EXEC_POLL_MS}
        rowKey={(e) => e.id}
        fetch={fetcher}
        onRowClick={(e) => setOpenExecution(e.id)}
        filters={{
          schema: execFiltersSchema,
          render: (form) => (
            <Control
              input={form.input.status}
              label=""
              clearable
              icon={CircleDot}
              clearLabel={String(
                tr("admin.workflows.statusAll", { default: "All statuses" }),
              )}
              triggerClassName="w-48"
              items={[
                { value: "pending", label: "pending" },
                { value: "running", label: "running" },
                { value: "completed", label: "completed" },
                { value: "failed", label: "failed" },
                { value: "timed_out", label: "timed_out" },
                { value: "compensating", label: "compensating" },
                { value: "compensated", label: "compensated" },
                { value: "compensation_failed", label: "compensation_failed" },
                { value: "cancelled", label: "cancelled" },
              ]}
            />
          ),
        }}
        columns={{
          status: {
            label: tr("admin.workflows.colStatus", { default: "Status" }),
            cell: (e) => <WorkflowStatusBadge status={e.status} />,
          },
          currentStep: {
            label: tr("admin.workflows.colStep", { default: "Step" }),
            cell: (e) =>
              e.currentStep ? (
                <code className="text-xs">{e.currentStep}</code>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
          createdAt: {
            label: tr("admin.workflows.colCreated", { default: "Created" }),
            sortable: true,
            cell: (e) => (
              <span className="text-muted-foreground text-xs">
                {String(l(e.createdAt, { date: "fromNow" }))}
              </span>
            ),
          },
          duration: {
            label: tr("admin.workflows.colDuration", { default: "Duration" }),
            align: "right",
            cell: (e) => {
              if (!e.startedAt || !e.completedAt) {
                return <span className="text-muted-foreground">—</span>;
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
          triggeredBy: {
            label: tr("admin.workflows.colTriggeredBy", {
              default: "Triggered by",
            }),
            cell: (e) => (
              <span className="text-muted-foreground text-xs">
                {e.triggeredByName ?? e.triggeredBy ?? "—"}
              </span>
            ),
          },
          error: {
            label: tr("admin.workflows.colError", { default: "Error" }),
            cell: (e) =>
              e.error ? (
                <span
                  className="text-destructive line-clamp-2 text-xs"
                  title={e.error}
                >
                  {e.error}
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
        }}
        emptyMessage={String(
          tr("admin.workflows.noExecs", { default: "No executions yet." }),
        )}
      />

      <WorkflowExecutionSheet
        executionId={openExecution}
        onClose={() => setOpenExecution(null)}
      />
    </>
  );
};
