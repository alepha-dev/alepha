import * as React from "react";

void React;

import { z } from "alepha";
import type { AdminJobController, JobRegistration } from "alepha/api/jobs";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import {
  Boxes,
  FolderTree,
  HeartPulse,
  Play,
  Shapes,
  Timer,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "../core/Badge.tsx";
import { useToast } from "../core/useToast.tsx";
import { DataTable } from "../table/DataTable.tsx";
import type { DataTableFilterFields } from "../table/dataTableTypes.ts";
import { AdminJobsTypeIcon } from "./AdminJobsTypeIcon.tsx";
import { AdminPage } from "./AdminPage.tsx";
import { useJobRetentionLabels } from "./useJobRetentionLabels.ts";

const POLL_MS = 30_000;

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
  const router = useRouter();
  const [jobs, setJobs] = useState<JobRegistration[]>([]);

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

  const filterFields = {
    search: { preset: "search" },
    type: {
      schema: z.enum(["cron", "queue", "direct"]),
      label: tr("admin.jobs.colType", { default: "Type" }),
      icon: Shapes,
      items: [
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
      ],
      control: {
        clearLabel: tr("admin.jobs.typeAll", { default: "All types" }),
      },
    },
    origin: {
      schema: z.enum(["system", "app"]),
      label: tr("admin.jobs.colOrigin", { default: "Origin" }),
      icon: Boxes,
      items: [
        {
          value: "system",
          label: tr("admin.jobs.originSystem", { default: "System" }),
        },
        { value: "app", label: tr("admin.jobs.originApp", { default: "App" }) },
      ],
      control: {
        clearLabel: tr("admin.jobs.originAll", { default: "All origins" }),
      },
    },
    domain: {
      schema: z.string(),
      label: tr("admin.jobs.filterDomain", { default: "Domain" }),
      icon: FolderTree,
      items: domainItems,
      control: {
        clearLabel: tr("admin.jobs.domainAll", { default: "All domains" }),
      },
    },
    health: {
      schema: z.enum(["lastFailed", "hasFailures", "noRuns"]),
      label: tr("admin.jobs.filterHealth", { default: "Health" }),
      icon: HeartPulse,
      items: [
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
          label: tr("admin.jobs.healthNoRuns", { default: "No runs kept" }),
        },
      ],
      control: {
        clearLabel: tr("admin.jobs.healthAll", { default: "Any health" }),
      },
    },
  } satisfies DataTableFilterFields;

  const canTrigger = client.triggerJob.can();

  // By route name: `jobDetail` is `/admin/jobs/:jobName` under `AdminRouter`,
  // and whatever path an application gave a page of that name elsewhere.
  const open = (job: JobRegistration) =>
    void router.push("jobDetail", { params: { jobName: job.name } });

  return (
    <AdminPage>
      <DataTable<JobRegistration, typeof filterFields>
        className="min-h-0 flex-1"
        persistenceKey="admin.jobs"
        rowKey={(j) => j.name}
        data={jobs}
        filter={matchesJobFilters}
        onRowClick={(j) => open(j)}
        filters={{ fields: filterFields }}
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
                  ? l(j.recent.lastRun, { date: "fromNow" })
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
            onClick: () => open(j),
          },
        ]}
        emptyMessage={tr("admin.jobs.none", { default: "No jobs registered." })}
      />
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
 * The filter values the job registry is narrowed by.
 */
export interface JobFilterValues {
  search?: string;
  type?: JobRegistration["type"];
  origin?: "system" | "app";
  domain?: string;
  health?: "lastFailed" | "hasFailures" | "noRuns";
}

/**
 * The table's filter predicate over the registry rows.
 */
export const matchesJobFilters = (
  job: JobRegistration,
  filters: JobFilterValues,
): boolean => {
  const search = (filters.search ?? "").trim().toLowerCase();
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
