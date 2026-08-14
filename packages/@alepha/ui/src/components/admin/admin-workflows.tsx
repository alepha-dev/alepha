import * as React from "react";

void React;

import { AdminPage } from "@alepha/ui/components/admin/admin-page";
import { WorkflowExecutionsPanel } from "@alepha/ui/components/admin/admin-workflows-executions-panel";
import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { Badge } from "@alepha/ui/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@alepha/ui/components/ui/sheet";
import { type Infer, type Page, z } from "alepha";
import type {
  AdminWorkflowController,
  WorkflowRegistration,
} from "alepha/api/workflows";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { ListOrdered, Search } from "lucide-react";
import { useCallback, useState } from "react";

const POLL_MS = 30_000;

const workflowFiltersSchema = z.object({
  search: z.string().optional(),
});
type WorkflowFilters = Infer<typeof workflowFiltersSchema>;

/**
 * Wrap an in-memory array as a `Page<T>` so it can feed `AlephaTable`'s
 * fetcher without server-side pagination — appropriate for the bounded
 * workflow registry.
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

function applyWorkflowFilters(
  workflows: WorkflowRegistration[],
  filters?: WorkflowFilters,
): WorkflowRegistration[] {
  const q = filters?.search?.trim().toLowerCase();
  if (!q) return workflows;
  return workflows.filter(
    (w) =>
      w.name.toLowerCase().includes(q) ||
      (w.tags?.some((t) => t.toLowerCase().includes(q)) ?? false),
  );
}

export function AdminWorkflows() {
  const client = useClient<AdminWorkflowController>();
  const { tr } = useI18n();
  const [openWorkflow, setOpenWorkflow] = useState<WorkflowRegistration | null>(
    null,
  );

  const fetcher = useCallback(
    async (params: { filters?: WorkflowFilters }) => {
      const workflows = await client.getWorkflowRegistry();
      return asPage(applyWorkflowFilters(workflows, params.filters));
    },
    [client],
  );

  return (
    <AdminPage>
      <AlephaTable<WorkflowRegistration>
        className="min-h-0 flex-1"
        persistenceKey="admin.workflows"
        pollMs={POLL_MS}
        rowKey={(w) => w.name}
        fetch={fetcher}
        onRowClick={(w) => setOpenWorkflow(w)}
        filters={{
          schema: workflowFiltersSchema,
          render: (form) => (
            <div className="w-72">
              <Control
                input={form.input.search}
                label=""
                icon={Search}
                placeholder={String(
                  tr("admin.workflows.searchPlaceholder", {
                    default: "Search…",
                  }),
                )}
              />
            </div>
          ),
        }}
        columns={{
          name: {
            label: tr("admin.workflows.colName", { default: "Name" }),
            sortable: true,
            cell: (w) => (
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{w.name}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {w.steps.map((s) => s.name).join(" → ")}
                </span>
              </div>
            ),
          },
          steps: {
            label: tr("admin.workflows.colSteps", { default: "Steps" }),
            align: "right",
            cell: (w) => w.stepCount,
          },
          onError: {
            label: tr("admin.workflows.colOnError", { default: "On error" }),
            cell: (w) => (
              <Badge
                variant={w.onError === "compensate" ? "secondary" : "outline"}
              >
                {w.onError}
              </Badge>
            ),
          },
          priority: {
            label: tr("admin.workflows.colPriority", { default: "Priority" }),
            cell: (w) => <Badge variant="outline">{w.priority}</Badge>,
          },
          running: {
            label: tr("admin.workflows.colRunning", { default: "Running" }),
            align: "right",
            cell: (w) => w.running,
          },
          pending: {
            label: tr("admin.workflows.colPending", { default: "Pending" }),
            align: "right",
            cell: (w) => w.pending,
          },
          failed: {
            label: tr("admin.workflows.colFailed", { default: "Failed" }),
            align: "right",
            cell: (w) => (
              <span className={w.failed > 0 ? "text-destructive" : undefined}>
                {w.failed}
              </span>
            ),
          },
        }}
        rowActions={(w) => [
          {
            label: tr("admin.workflows.viewExecutions", {
              default: "View executions",
            }),
            icon: ListOrdered,
            onClick: () => setOpenWorkflow(w),
          },
        ]}
        emptyMessage={String(
          tr("admin.workflows.none", { default: "No workflows registered." }),
        )}
      />

      <Sheet
        open={openWorkflow !== null}
        onOpenChange={(open) => {
          if (!open) setOpenWorkflow(null);
        }}
      >
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 data-[side=right]:sm:max-w-[60vw]"
        >
          {openWorkflow && (
            <>
              <SheetHeader>
                <SheetTitle>{openWorkflow.name}</SheetTitle>
                <SheetDescription>
                  {tr("admin.workflows.execsDescription", {
                    default: "Executions for this workflow.",
                  })}
                </SheetDescription>
              </SheetHeader>
              <div className="flex min-h-0 flex-1 flex-col p-4">
                <WorkflowExecutionsPanel workflowName={openWorkflow.name} />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </AdminPage>
  );
}

export default AdminWorkflows;
