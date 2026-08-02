import * as React from "react";

void React;

import { JobExecutionsPanel } from "@alepha/ui/components/admin/admin-jobs-executions-panel";
import { AdminPage } from "@alepha/ui/components/admin/admin-page";
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
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { type Infer, type Page, z } from "alepha";
import type { AdminJobController, JobRegistration } from "alepha/api/jobs";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Play, Search, Timer } from "lucide-react";
import { useCallback, useState } from "react";

const POLL_MS = 30_000;

const jobFiltersSchema = z.object({
  search: z.string().optional(),
  type: z.string().optional(),
  priority: z.string().optional(),
});
type JobFilters = Infer<typeof jobFiltersSchema>;

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
  const toast = useToast();
  const [openJob, setOpenJob] = useState<JobRegistration | null>(null);

  const fetcher = useCallback(
    async (params: { sort?: string; filters?: JobFilters }) => {
      const jobs = await client.listJobs();
      return asPage(applyJobFilters(jobs, params.filters, params.sort));
    },
    [client],
  );

  const triggerAction = useAction<[JobRegistration], void>(
    {
      handler: async (job) => {
        await client.triggerJob({ params: { name: job.name }, body: {} });
        toast.success(
          tr("admin.jobs.triggered", {
            default: `Triggered ${job.name}`,
            args: [job.name],
          }),
        );
      },
    },
    [client, toast, tr],
  );

  const trigger = useCallback(
    async (job: JobRegistration, refresh: () => void) => {
      await triggerAction.run(job);
      refresh();
    },
    [triggerAction.run],
  );

  return (
    <AdminPage>
      <AlephaTable<JobRegistration>
        className="min-h-0 flex-1"
        persistenceKey="admin.jobs"
        pollMs={POLL_MS}
        rowKey={(j) => j.name}
        fetch={fetcher}
        onRowClick={(j) => setOpenJob(j)}
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
                  : tr("admin.jobs.unknown", { default: "unknown" })}
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
          className="flex w-full flex-col gap-0 data-[side=right]:sm:max-w-[50vw]"
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
                <JobExecutionsPanel jobName={openJob.name} />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </AdminPage>
  );
}

export default AdminJobs;
