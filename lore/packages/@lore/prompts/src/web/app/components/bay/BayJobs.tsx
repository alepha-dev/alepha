import { cn, textLinkUnderlineClassName, useDialog } from "@alepha/ui";
import { AccountPage } from "@alepha/ui/account";
import { DataTable, type DataTableFilterFields } from "@alepha/ui/table";
import type { HostJobController } from "@lore/core/api";
import type { HostMachineJob } from "@lore/core/schemas";
import { type I18n, currentHostAtom } from "@lore/core/web";
import { z } from "alepha";
import { useAction, useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { CircleDot, CircleStop, FolderKanban } from "lucide-react";
import { useState } from "react";

import JobStatusBadge from "../host-jobs/JobStatusBadge.tsx";
import { argsText, durationText } from "../host-jobs/jobText.ts";

/**
 * A host's Jobs tab (#Q4524): every job of the machine, newest first,
 * whatever its project, for the members of the host's home project.
 *
 * A job belongs to its project. The server answers a job of a project the
 * reader holds no `host:read` in with what the machine knows alone
 * (`readable: false`): it is drawn with its project, status, times and
 * tokens, and no link, prompt or cause. A readable one links to its page in
 * its own project, which that project gates.
 *
 * Cancel is the operator's (`host:update` in the home project), on any job
 * in flight: it frees the machine and reads nothing of the job.
 */
const BayJobs = () => {
  const { tr, l } = useI18n<I18n, "en">();
  const api = useClient<HostJobController>();
  const dialog = useDialog();
  const [host] = useStore(currentHostAtom);
  const [polling, setPolling] = useState(false);
  const hostId = host?.id;

  const jobs = useQuery(
    {
      enabled: Boolean(hostId),
      key: ["host-machine-jobs", hostId],
      keepPreviousData: true,
      runEvery: polling ? 3000 : undefined,
      handler: async () => {
        if (!hostId) return undefined;
        const page = await api.listHostJobs({
          params: { hostId },
          query: { limit: 200 },
        });
        setPolling(page.items.some((job) => inFlight(job)));
        return page;
      },
    },
    [hostId, polling],
  );

  // Asked first, as on the job page (#Q4493): a cancel kills the agent
  // mid-run.
  const cancel = useAction<[job: HostMachineJob], void>(
    {
      handler: async (_ctx, job) => {
        if (!hostId) return;
        const ok = await dialog.confirm({
          title: tr("jobs.cancel.title"),
          description: tr("jobs.cancel.confirm"),
          confirmLabel: tr("jobs.cancel.yes"),
          cancelLabel: tr("jobs.cancel.no"),
          destructive: true,
        });
        if (!ok) return;
        await api.cancelHostJob({ params: { hostId, jobId: job.id } });
        await jobs.refetch();
      },
    },
    [api, hostId],
  );

  if (!host) return null;
  const canCancel = host.can.includes("host:update");
  const items = jobs.data?.items ?? [];
  const distinct = (values: string[]) =>
    [...new Set(values)].sort((a, b) => a.localeCompare(b));
  const options = (values: string[]) =>
    values.map((it) => ({ value: it, label: it }));
  const filterFields = {
    project: {
      schema: z.text({ maxLength: 120 }),
      label: tr("jobs.col.project"),
      icon: FolderKanban,
      mode: "default",
      items: options(distinct(items.map((it) => it.project.title))),
      control: { clearLabel: tr("jobs.filter.allProjects") },
    },
    status: {
      schema: z.text({ maxLength: 16 }),
      label: tr("jobs.col.status"),
      icon: CircleDot,
      mode: "default",
      column: "status",
      items: options(distinct(items.map((it) => it.status))),
      control: { clearLabel: tr("jobs.filter.allStatuses") },
    },
  } satisfies DataTableFilterFields;
  // By hand (by whom), by an event (which), or by the schedule. Nothing for
  // a job the reader cannot read: its cause is its project's.
  const causeText = (job: HostMachineJob): string => {
    if (!job.readable) return "";
    if (job.cause?.kind === "event") {
      return tr("jobs.cause.event", { args: [job.cause.event ?? ""] });
    }
    if (job.cause?.kind === "schedule") return tr("jobs.cause.schedule");
    return job.startedByName
      ? tr("jobs.cause.handBy", { args: [job.startedByName] })
      : tr("jobs.cause.hand");
  };

  return (
    <AccountPage variant="table">
      <DataTable<HostMachineJob, typeof filterFields>
        className="min-h-0 flex-1"
        data={items}
        filters={{ fields: filterFields }}
        // Exact, where the built-in matching takes a string as a substring.
        filter={(job, values) =>
          (!values.project || job.project.title === values.project) &&
          (!values.status || job.status === values.status)
        }
        emptyState={{
          title: tr("jobs.empty"),
          description: tr("jobs.empty.description"),
        }}
        columns={{
          queuedAt: {
            label: tr("jobs.col.when"),
            sortable: true,
            cell: (job) =>
              job.readable ? (
                <Link
                  href={`/${job.project.slug ?? job.project.id}/jobs/${job.id}`}
                  className={cn(textLinkUnderlineClassName, "text-xs")}
                >
                  {l(job.queuedAt, { date: "lll" })}
                </Link>
              ) : (
                <span className="text-muted-foreground text-xs">
                  {l(job.queuedAt, { date: "lll" })}
                </span>
              ),
          },
          project: {
            label: tr("jobs.col.project"),
            sortable: true,
            sortValue: (job) => job.project.title,
            cell: (job) => (
              <span className="text-sm" data-testid="host-job-project">
                {job.project.title}
              </span>
            ),
          },
          prompt: {
            label: tr("jobs.col.prompt"),
            cell: (job) => (
              <span className="flex min-w-0 flex-col gap-0.5">
                <span
                  className={cn(
                    "text-sm",
                    job.readable ? "font-medium" : "text-muted-foreground",
                  )}
                  data-testid="host-job-what"
                >
                  {job.prompt ?? job.kind}
                </span>
                {job.readable && (
                  <span className="text-muted-foreground truncate text-xs">
                    {/* A check's subject is this very host: nothing to say. */}
                    {argsText(job) ||
                      (job.subjectType && job.subjectType !== "host"
                        ? `${job.subjectType} ${job.subjectId ?? ""}`
                        : "")}
                  </span>
                )}
              </span>
            ),
          },
          cause: {
            label: tr("jobs.col.cause"),
            cell: (job) => (
              <span className="text-muted-foreground text-xs">
                {causeText(job)}
              </span>
            ),
          },
          status: {
            label: tr("jobs.col.status"),
            cell: (job) => <JobStatusBadge status={job.status} />,
          },
          duration: {
            label: tr("jobs.col.duration"),
            sortable: true,
            sortValue: (job) =>
              job.startedAt && job.endedAt
                ? Date.parse(job.endedAt) - Date.parse(job.startedAt)
                : undefined,
            cell: (job) => (
              <span className="text-muted-foreground text-xs tabular-nums">
                {job.startedAt && job.endedAt
                  ? durationText(
                      (Date.parse(job.endedAt) - Date.parse(job.startedAt)) /
                        1000,
                    )
                  : ""}
              </span>
            ),
          },
          tokens: {
            label: tr("jobs.field.tokens"),
            align: "right",
            cell: (job) => (
              <span className="text-muted-foreground text-xs tabular-nums">
                {job.inputTokens === undefined && job.outputTokens === undefined
                  ? ""
                  : `${(job.inputTokens ?? 0).toLocaleString()} / ${(job.outputTokens ?? 0).toLocaleString()}`}
              </span>
            ),
          },
        }}
        rowActionsDisplay="inline"
        rowActions={(job) =>
          canCancel && inFlight(job)
            ? [
                {
                  label: tr("jobs.cancel"),
                  icon: CircleStop,
                  destructive: true,
                  disabled: () => cancel.loading,
                  onClick: () => void cancel.run(job),
                },
              ]
            : []
        }
      />
    </AccountPage>
  );
};

const inFlight = (job: HostMachineJob): boolean =>
  job.status === "queued" || job.status === "running";

export default BayJobs;
