import * as React from "react";

void React;

import { AdminJobsExecutionsPanel } from "@alepha/ui/components/admin/admin-jobs-executions-panel";
import { AdminJobsTypeIcon } from "@alepha/ui/components/admin/admin-jobs-type-icon";
import { AdminPage } from "@alepha/ui/components/admin/admin-page";
import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { FilterSlot } from "@alepha/ui/components/filter-slot/filter-slot";
import { Badge } from "@alepha/ui/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@alepha/ui/components/ui/sheet";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { z } from "alepha";
import type { AdminJobController, JobRegistration } from "alepha/api/jobs";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import {
  Boxes,
  FolderTree,
  HeartPulse,
  Play,
  Search,
  Shapes,
  Timer,
} from "lucide-react";
import { useMemo, useState } from "react";

import { useJobRetentionLabels } from "./admin-jobs-retention-labels.ts";

const POLL_MS = 30_000;

const jobFiltersSchema = z.object({
  search: z.string().optional(),
  type: z.string().optional(),
  origin: z.string().optional(),
  domain: z.string().optional(),
  health: z.string().optional(),
});

/**
 * The job registry: every registered job, what it is, when it last ran and
 * what it keeps.
 *
 * The registry is a few dozen rows the server answers in one call, so the
 * table holds them as `data` and filters, sorts and pages them itself; the
 * list is re-read every 30 seconds.
 */
export const AdminJobs = () => {
  const client = useClient<AdminJobController>();
  const { l, tr } = useI18n();
  const toast = useToast();
  const retention = useJobRetentionLabels();
  const [jobs, setJobs] = useState<JobRegistration[]>([]);
  const [openJob, setOpenJob] = useState<JobRegistration | null>(null);

  const load = useAction(
    {
      handler: async () => {
        setJobs(await client.listJobs());
      },
      runOnInit: true,
      runEvery: POLL_MS,
    },
    [client],
  );

  const trigger = useAction<[JobRegistration], void>(
    {
      handler: async (job) => {
        await client.triggerJob({ params: { name: job.name }, body: {} });
        toast.success(
          tr("admin.jobs.triggered", {
            default: `Triggered ${job.name}`,
            args: [job.name],
          }),
        );
        await load.run();
      },
    },
    [client, toast, tr],
  );

  const domainItems = useMemo(
    () =>
      [...new Set(jobs.map((j) => jobDomain(j.name)))]
        .sort()
        .map((domain) => ({ value: domain, label: domain })),
    [jobs],
  );

  const canTrigger = client.triggerJob.can();

  return (
    <AdminPage>
      <AlephaTable<JobRegistration>
        className="min-h-0 flex-1"
        persistenceKey="admin.jobs"
        rowKey={(j) => j.name}
        data={jobs}
        filter={matchesJobFilters}
        onRowClick={(j) => setOpenJob(j)}
        filters={{
          schema: jobFiltersSchema,
          render: (form) => (
            <div className="flex flex-wrap items-center gap-2">
              <FilterSlot>
                <Control
                  input={form.input.search}
                  label=""
                  icon={Search}
                  placeholder={String(
                    tr("admin.search", { default: "Search" }),
                  )}
                  inputProps={{
                    "aria-label": String(
                      tr("admin.search", { default: "Search" }),
                    ),
                  }}
                />
              </FilterSlot>
              <Control
                input={form.input.type}
                label=""
                clearable
                icon={Shapes}
                clearLabel={String(
                  tr("admin.jobs.typeAll", { default: "All types" }),
                )}
                triggerClassName="w-36"
                items={[
                  {
                    value: "cron",
                    label: tr("admin.jobs.typeCron", { default: "Cron" }),
                  },
                  {
                    value: "queue",
                    label: tr("admin.jobs.typeQueue", { default: "Queue" }),
                  },
                  {
                    value: "direct",
                    label: tr("admin.jobs.typeDirect", { default: "Direct" }),
                  },
                ]}
              />
              <Control
                input={form.input.origin}
                label=""
                clearable
                icon={Boxes}
                clearLabel={String(
                  tr("admin.jobs.originAll", { default: "All origins" }),
                )}
                triggerClassName="w-36"
                items={[
                  {
                    value: "system",
                    label: tr("admin.jobs.originSystem", {
                      default: "System",
                    }),
                  },
                  {
                    value: "app",
                    label: tr("admin.jobs.originApp", { default: "App" }),
                  },
                ]}
              />
              <Control
                input={form.input.domain}
                label=""
                clearable
                icon={FolderTree}
                clearLabel={String(
                  tr("admin.jobs.domainAll", { default: "All domains" }),
                )}
                triggerClassName="w-40"
                items={domainItems}
              />
              <Control
                input={form.input.health}
                label=""
                clearable
                icon={HeartPulse}
                clearLabel={String(
                  tr("admin.jobs.healthAll", { default: "Any health" }),
                )}
                triggerClassName="w-44"
                items={[
                  {
                    value: "lastFailed",
                    label: tr("admin.jobs.healthLastFailed", {
                      default: "Last run failed",
                    }),
                  },
                  {
                    value: "hasFailures",
                    label: tr("admin.jobs.healthHasFailures", {
                      default: "Has failures",
                    }),
                  },
                  {
                    value: "noRuns",
                    label: tr("admin.jobs.healthNoRuns", {
                      default: "No runs kept",
                    }),
                  },
                ]}
              />
            </div>
          ),
        }}
        columns={{
          name: {
            label: tr("admin.jobs.colName", { default: "Name" }),
            sortable: true,
            sortValue: (j) => j.name,
            cell: (j) => (
              <div className="flex min-w-0 items-center gap-2">
                <AdminJobsTypeIcon type={j.type} />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{j.name}</span>
                  {j.description && (
                    <span className="text-muted-foreground truncate text-xs">
                      {j.description}
                    </span>
                  )}
                </div>
              </div>
            ),
          },
          cron: {
            label: tr("admin.jobs.colSchedule", { default: "Schedule" }),
            cell: (j) =>
              j.cron ? <code className="text-xs">{j.cron}</code> : null,
          },
          retention: {
            label: tr("admin.jobs.colRetention", { default: "Retention" }),
            cell: (j) => (
              <span
                className="text-muted-foreground inline-flex items-center gap-1.5 text-xs"
                title={retention.sentence(j.retention)}
              >
                {retention.short(j.retention)}
                {retention.isDefault(j.retention) && (
                  <Badge variant="outline" className="text-[10px]">
                    {tr("admin.jobs.retention.default", {
                      default: "default",
                    })}
                  </Badge>
                )}
              </span>
            ),
          },
          lastRun: {
            label: tr("admin.jobs.colLastRun", { default: "Last run" }),
            sortable: true,
            sortValue: (j) => j.recent.lastRun ?? "",
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
            hint: tr("admin.jobs.colOkHint", {
              default:
                "Successful runs still kept, not every run: see Retention.",
            }),
            align: "right",
            sortable: true,
            sortValue: (j) => j.recent.ok,
            cell: (j) => j.recent.ok,
          },
          errors: {
            label: tr("admin.jobs.colErrors", { default: "Errors" }),
            hint: tr("admin.jobs.colErrorsHint", {
              default: "Failed runs still kept, not every run: see Retention.",
            }),
            align: "right",
            sortable: true,
            sortValue: (j) => j.recent.error,
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
          // A cron only: a pushed job needs a payload this button cannot
          // send, and the server refuses a trigger without one.
          ...(j.type === "cron" && canTrigger
            ? [
                {
                  label: tr("admin.jobs.trigger", { default: "Trigger now" }),
                  icon: Play,
                  onClick: () => trigger.run(j),
                },
              ]
            : []),
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
                <AdminJobsExecutionsPanel jobName={openJob.name} />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </AdminPage>
  );
};

export default AdminJobs;

/**
 * The domain a job belongs to: the segment after `system.` for a framework
 * job, the first segment otherwise.
 */
export const jobDomain = (name: string): string => {
  const segments = name.split(".");
  return segments[0] === "system" ? (segments[1] ?? "") : (segments[0] ?? "");
};

/**
 * The table's filter predicate over the registry rows.
 */
export const matchesJobFilters = (
  job: JobRegistration,
  filters: Record<string, any>,
): boolean => {
  const search = String(filters.search ?? "")
    .trim()
    .toLowerCase();
  if (
    search &&
    !job.name.toLowerCase().includes(search) &&
    !(job.description?.toLowerCase().includes(search) ?? false)
  ) {
    return false;
  }
  if (filters.type && job.type !== filters.type) return false;
  if (filters.origin) {
    const system = job.name.startsWith("system.");
    if ((filters.origin === "system") !== system) return false;
  }
  if (filters.domain && jobDomain(job.name) !== filters.domain) return false;
  switch (filters.health) {
    case "lastFailed":
      return job.recent.lastStatus === "error";
    case "hasFailures":
      return job.recent.error > 0;
    case "noRuns":
      return job.recent.ok + job.recent.error === 0;
    default:
      return true;
  }
};
