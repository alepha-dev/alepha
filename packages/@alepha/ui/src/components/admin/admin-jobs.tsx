import * as React from "react";

void React;

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
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { type Page, type Static, t } from "alepha";
import type {
  AdminJobController,
  JobExecutionResource,
  JobRegistration,
} from "alepha/api/jobs";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Ban, Play, RotateCcw, Search, Timer } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

const POLL_MS = 30_000;
const EXEC_POLL_MS = 10_000;

const jobFiltersSchema = t.object({
  search: t.optional(t.string()),
  type: t.optional(t.string()),
  priority: t.optional(t.string()),
});
type JobFilters = Static<typeof jobFiltersSchema>;

const execFiltersSchema = t.object({
  status: t.optional(t.string()),
});
type ExecFilters = Static<typeof execFiltersSchema>;

/**
 * Wrap an in-memory array as a `Page<T>` so it can feed `AlephaTable`'s
 * fetcher without server-side pagination — appropriate for bounded
 * datasets like the job registry (usually <50 entries).
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

function applyJobFilters(
  jobs: JobRegistration[],
  filters?: JobFilters,
  sort?: string,
): JobRegistration[] {
  let out = jobs;
  const q = filters?.search?.trim().toLowerCase();
  if (q) {
    out = out.filter(
      (j) =>
        j.name.toLowerCase().includes(q) ||
        (j.description?.toLowerCase().includes(q) ?? false),
    );
  }
  if (filters?.type) out = out.filter((j) => j.type === filters.type);
  if (filters?.priority) {
    out = out.filter((j) => j.priority === filters.priority);
  }
  if (sort) {
    const desc = sort.startsWith("-");
    const field = (desc ? sort.slice(1) : sort) as keyof JobRegistration;
    out = [...out].sort((a, b) => {
      const av = (a as any)[field] ?? "";
      const bv = (b as any)[field] ?? "";
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return desc ? -cmp : cmp;
    });
  }
  return out;
}

export function AdminJobs() {
  const client = useClient<AdminJobController>();
  const { l, tr } = useI18n();
  const dialog = useDialog();
  const [openJob, setOpenJob] = useState<JobRegistration | null>(null);

  const fetcher = useCallback(
    async (params: { sort?: string; filters?: JobFilters }) => {
      const jobs = await client.listJobs();
      return asPage(applyJobFilters(jobs, params.filters, params.sort));
    },
    [client],
  );

  const trigger = useCallback(
    async (job: JobRegistration, refresh: () => void) => {
      try {
        await client.triggerJob({ params: { name: job.name }, body: {} });
        toast.success(
          tr("admin.jobs.triggered", {
            default: `Triggered ${job.name}`,
            args: [job.name],
          }),
        );
        refresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(
          tr("admin.jobs.triggerFailed", {
            default: `Failed to trigger: ${msg}`,
            args: [msg],
          }),
        );
      }
    },
    [client, tr],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <AlephaTable<JobRegistration>
        className="min-h-0 flex-1"
        persistenceKey="admin.jobs"
        pollMs={POLL_MS}
        rowKey={(j) => j.name}
        fetch={fetcher}
        filters={{
          schema: jobFiltersSchema,
          render: (form) => (
            <div className="flex items-center gap-2">
              <div className="w-72">
                <Control
                  input={form.input.search}
                  label=""
                  icon={Search}
                  placeholder={String(
                    tr("admin.jobs.searchPlaceholder", { default: "Search…" }),
                  )}
                />
              </div>
              <Control
                input={form.input.type}
                label=""
                clearable
                clearLabel={String(
                  tr("admin.jobs.typeAll", { default: "All types" }),
                )}
                triggerClassName="w-36"
                items={[
                  { value: "cron", label: "cron" },
                  { value: "queue", label: "queue" },
                  { value: "direct", label: "direct" },
                ]}
              />
              <Control
                input={form.input.priority}
                label=""
                clearable
                clearLabel={String(
                  tr("admin.jobs.priorityAll", { default: "All priorities" }),
                )}
                triggerClassName="w-40"
                items={[
                  { value: "critical", label: "critical" },
                  { value: "high", label: "high" },
                  { value: "normal", label: "normal" },
                  { value: "low", label: "low" },
                ]}
              />
            </div>
          ),
        }}
        columns={{
          name: {
            label: tr("admin.jobs.colName", { default: "Name" }),
            sortable: true,
            cell: (j) => (
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{j.name}</span>
                {j.description && (
                  <span className="text-muted-foreground truncate text-xs">
                    {j.description}
                  </span>
                )}
              </div>
            ),
          },
          type: {
            label: tr("admin.jobs.colType", { default: "Type" }),
            sortable: true,
            cell: (j) => (
              <Badge variant={j.type === "cron" ? "default" : "secondary"}>
                {j.type}
              </Badge>
            ),
          },
          cron: {
            label: tr("admin.jobs.colSchedule", { default: "Schedule" }),
            cell: (j) =>
              j.cron ? (
                <code className="text-xs">{j.cron}</code>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
          priority: {
            label: tr("admin.jobs.colPriority", { default: "Priority" }),
            sortable: true,
            cell: (j) => <Badge variant="outline">{j.priority}</Badge>,
          },
          lastRun: {
            label: tr("admin.jobs.colLastRun", { default: "Last run" }),
            cell: (j) => (
              <span className="text-muted-foreground text-xs">
                {j.recent.lastRun
                  ? String(l(j.recent.lastRun, { date: "fromNow" }))
                  : tr("admin.jobs.never", { default: "never" })}
              </span>
            ),
          },
          ok: {
            label: tr("admin.jobs.colOk", { default: "OK" }),
            align: "right",
            cell: (j) => j.recent.ok,
          },
          errors: {
            label: tr("admin.jobs.colErrors", { default: "Errors" }),
            align: "right",
            cell: (j) => (
              <span
                className={j.recent.error > 0 ? "text-destructive" : undefined}
              >
                {j.recent.error}
              </span>
            ),
          },
        }}
        rowActions={(j) => [
          {
            label: tr("admin.jobs.trigger", { default: "Trigger now" }),
            icon: Play,
            onClick: (_j, { refresh }) => trigger(j, refresh),
          },
          {
            label: tr("admin.jobs.viewExecutions", {
              default: "View executions",
            }),
            icon: Timer,
            onClick: () => setOpenJob(j),
          },
        ]}
        emptyMessage={String(
          tr("admin.jobs.none", { default: "No jobs registered." }),
        )}
      />

      <Sheet
        open={openJob !== null}
        onOpenChange={(open) => {
          if (!open) setOpenJob(null);
        }}
      >
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 sm:max-w-2xl"
        >
          {openJob && (
            <>
              <SheetHeader>
                <SheetTitle>{openJob.name}</SheetTitle>
                <SheetDescription>
                  {tr("admin.jobs.execsDescription", {
                    default: "Recent executions for this job.",
                  })}
                </SheetDescription>
              </SheetHeader>
              <div className="flex min-h-0 flex-1 flex-col p-4">
                <ExecutionsPanel
                  jobName={openJob.name}
                  client={client}
                  l={l}
                  tr={tr}
                  dialog={dialog}
                />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Executions panel — inner AlephaTable of JobExecutionResource
 * ──────────────────────────────────────────────────────────────────────── */

interface ExecutionsPanelProps {
  jobName: string;
  client: ReturnType<typeof useClient<AdminJobController>>;
  l: ReturnType<typeof useI18n>["l"];
  tr: ReturnType<typeof useI18n>["tr"];
  dialog: ReturnType<typeof useDialog>;
}

function ExecutionsPanel(props: ExecutionsPanelProps) {
  const { jobName, client, l, tr, dialog } = props;

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

  const retry = useCallback(
    async (e: JobExecutionResource, refresh: () => void) => {
      const ok = await dialog.confirm({
        title: tr("admin.jobs.retryTitle", { default: "Retry execution" }),
        description: tr("admin.jobs.retryConfirm", {
          default: "Re-queue this execution for another attempt?",
        }),
      });
      if (!ok) return;
      await client.retryExecution({ params: { id: e.id } });
      toast.success(
        tr("admin.jobs.retried", { default: "Execution re-queued" }),
      );
      refresh();
    },
    [client, dialog, tr],
  );

  const cancel = useCallback(
    async (e: JobExecutionResource, refresh: () => void) => {
      const ok = await dialog.confirm({
        title: tr("admin.jobs.cancelTitle", { default: "Cancel execution" }),
        description: tr("admin.jobs.cancelConfirm", {
          default: "Cancel this pending execution? It will not run.",
        }),
        destructive: true,
      });
      if (!ok) return;
      await client.cancelExecution({ params: { id: e.id } });
      toast.success(
        tr("admin.jobs.cancelled", { default: "Execution cancelled" }),
      );
      refresh();
    },
    [client, dialog, tr],
  );

  return (
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
            clearLabel={String(
              tr("admin.jobs.statusAll", { default: "All statuses" }),
            )}
            triggerClassName="w-40"
            items={[
              { value: "pending", label: "pending" },
              { value: "running", label: "running" },
              { value: "scheduled", label: "scheduled" },
              { value: "ok", label: "ok" },
              { value: "error", label: "error" },
              { value: "cancelled", label: "cancelled" },
            ]}
          />
        ),
      }}
      columns={{
        status: {
          label: tr("admin.jobs.colStatus", { default: "Status" }),
          cell: (e) => <StatusBadge status={e.status} tr={tr} />,
        },
        startedAt: {
          label: tr("admin.jobs.colStarted", { default: "Started" }),
          cell: (e) => (
            <span className="text-muted-foreground text-xs">
              {e.startedAt
                ? String(l(e.startedAt, { date: "fromNow" }))
                : tr("admin.jobs.notStarted", { default: "—" })}
            </span>
          ),
        },
        duration: {
          label: tr("admin.jobs.colDuration", { default: "Duration" }),
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
        attempt: {
          label: tr("admin.jobs.colAttempt", { default: "Attempt" }),
          align: "right",
          cell: (e) => (
            <span className="text-xs">
              {e.attempt}/{e.maxAttempts}
            </span>
          ),
        },
        triggeredBy: {
          label: tr("admin.jobs.colTriggeredBy", { default: "Triggered by" }),
          cell: (e) => (
            <span className="text-muted-foreground text-xs">
              {e.triggeredByName ?? e.triggeredBy ?? "—"}
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
              <span className="text-muted-foreground">—</span>
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
        if (e.can.retry) {
          actions.push({
            label: tr("admin.jobs.retry", { default: "Retry" }),
            icon: RotateCcw,
            onClick: (_e, { refresh }) => retry(e, refresh),
          });
        }
        if (e.can.cancel) {
          actions.push({
            label: tr("admin.jobs.cancel", { default: "Cancel" }),
            icon: Ban,
            destructive: true,
            onClick: (_e, { refresh }) => cancel(e, refresh),
          });
        }
        return actions;
      }}
      emptyMessage={String(
        tr("admin.jobs.noExecs", { default: "No executions yet." }),
      )}
    />
  );
}

function StatusBadge({
  status,
  tr,
}: {
  status: JobExecutionResource["status"];
  tr: ReturnType<typeof useI18n>["tr"];
}) {
  const map: Record<
    JobExecutionResource["status"],
    "default" | "secondary" | "outline" | "destructive"
  > = {
    pending: "secondary",
    scheduled: "secondary",
    running: "default",
    ok: "outline",
    error: "destructive",
    cancelled: "outline",
  };
  return (
    <Badge variant={map[status]}>
      {tr(`admin.jobs.status.${status}` as any, { default: status })}
    </Badge>
  );
}
