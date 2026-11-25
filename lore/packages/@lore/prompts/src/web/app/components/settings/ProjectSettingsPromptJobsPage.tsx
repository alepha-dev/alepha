import { cn, textLinkUnderlineClassName } from "@alepha/ui";
import { DataTable, type DataTableFilterFields } from "@alepha/ui/table";
import type { HostJobController } from "@lore/core/api";
import type { HostJobResource } from "@lore/core/schemas";
import { type I18n, currentProjectAtom } from "@lore/core/web";
import { z } from "alepha";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { CircleDot, Server, Sparkles } from "lucide-react";
import { useState } from "react";

import type { PromptController } from "../../../../api/controllers/PromptController.ts";
import JobStatusBadge from "../host-jobs/JobStatusBadge.tsx";

/**
 * Settings > Prompts > Jobs (#Q4281): the project's jobs, newest first, each
 * with its prompt and args, its cause, where it ran, how it ended and how
 * long it took, filtered by prompt, status and host on the table's own
 * filter bar (#Q4305), each offering what the loaded jobs hold. A job
 * belongs to the project, not to a host: no host page lists them.
 * `?prompt=` opens it filtered on one prompt, the Prompts tab's "Jobs"
 * entry. Polled every few seconds while one is in flight.
 */
const ProjectSettingsPromptJobsPage = () => {
  const { tr, l } = useI18n<I18n, "en">();
  const api = useClient<HostJobController>();
  const prompts = useClient<PromptController>();
  const router = useRouter();
  const [project] = useStore(currentProjectAtom);
  const [polling, setPolling] = useState(false);
  const asked = (router.query as Record<string, unknown>).prompt;

  const { data } = useQuery(
    {
      enabled: Boolean(project),
      key: ["host-jobs", project?.id],
      keepPreviousData: true,
      runEvery: polling ? 3000 : undefined,
      handler: async () => {
        if (!project) return undefined;
        const page = await api.listProjectJobs({
          params: { projectId: project.id },
          query: { limit: 200 },
        });
        setPolling(
          page.items.some(
            (job) => job.status === "queued" || job.status === "running",
          ),
        );
        return page;
      },
    },
    [project?.id, polling],
  );
  const list = useQuery(
    {
      enabled: Boolean(project),
      key: ["project-prompts", project?.id],
      handler: () =>
        prompts.listPrompts({ params: { projectId: project?.id as number } }),
      onError: () => {},
    },
    [prompts, project?.id],
  );
  if (!project) return null;
  const slug = project.slug ?? String(project.id);
  const titleOf = new Map(
    (list.data?.items ?? []).map((it) => [it.name, it.title]),
  );
  const jobs = data?.items ?? [];
  const distinct = (values: Array<string | undefined>) =>
    [...new Set(values.filter((it): it is string => !!it))].sort((a, b) =>
      a.localeCompare(b),
    );
  const options = (values: string[], label = (it: string) => it) =>
    values.map((it) => ({ value: it, label: label(it) }));
  // On the bar from the start, each offering what the loaded jobs hold. The
  // prompt asked for by `?prompt=` is offered even before a job of it loads.
  const filterFields = {
    prompt: {
      schema: z.text({ maxLength: 64 }),
      label: tr("jobs.col.prompt"),
      icon: Sparkles,
      mode: "default",
      items: options(
        distinct([
          ...jobs.map((it) => it.prompt),
          ...(typeof asked === "string" ? [asked] : []),
        ]),
        (name) => titleOf.get(name) ?? name,
      ),
      control: { clearLabel: tr("jobs.filter.all") },
    },
    status: {
      schema: z.text({ maxLength: 16 }),
      label: tr("jobs.col.status"),
      icon: CircleDot,
      mode: "default",
      column: "status",
      items: options(distinct(jobs.map((it) => it.status))),
      control: { clearLabel: tr("jobs.filter.all") },
    },
    host: {
      schema: z.text({ maxLength: 64 }),
      label: tr("jobs.col.host"),
      icon: Server,
      mode: "default",
      column: "hostSlug",
      items: options(distinct(jobs.map((it) => it.hostSlug))),
      control: { clearLabel: tr("jobs.filter.all") },
    },
  } satisfies DataTableFilterFields;
  // By hand (by whom), by an event (which), or by the schedule.
  const causeText = (job: HostJobResource): string => {
    if (job.cause?.kind === "event") {
      return tr("jobs.cause.event", { args: [job.cause.event ?? ""] });
    }
    if (job.cause?.kind === "schedule") return tr("jobs.cause.schedule");
    return job.startedByName
      ? tr("jobs.cause.handBy", { args: [job.startedByName] })
      : tr("jobs.cause.hand");
  };

  return (
    <div className="-m-4 flex min-h-0 flex-1 flex-col md:-m-6">
      <DataTable<HostJobResource, typeof filterFields>
        className="min-h-0 flex-1"
        flat
        data={jobs}
        filters={{
          fields: filterFields,
          // The Prompts tab's "Jobs" entry: `?prompt=<name>`.
          ...(typeof asked === "string"
            ? { seedValues: { prompt: asked } }
            : {}),
        }}
        // Exact, where the built-in matching takes a string as a substring:
        // `triage` must not also list `triage-errors`.
        filter={(job, filters) =>
          (!filters.prompt || job.prompt === filters.prompt) &&
          (!filters.status || job.status === filters.status) &&
          (!filters.host || job.hostSlug === filters.host)
        }
        emptyState={{
          title: tr("jobs.empty"),
          description: tr("jobs.empty.description"),
        }}
        columns={{
          queuedAt: {
            label: tr("jobs.col.when"),
            sortable: true,
            cell: (job) => (
              <Link
                href={`/${slug}/jobs/${job.id}`}
                className={cn(textLinkUnderlineClassName, "text-xs")}
              >
                {l(job.queuedAt, { date: "lll" })}
              </Link>
            ),
          },
          prompt: {
            label: tr("jobs.col.prompt"),
            cell: (job) => (
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium" data-testid="job-prompt">
                  {job.prompt
                    ? (titleOf.get(job.prompt) ?? job.prompt)
                    : job.kind}
                </span>
                <span className="text-muted-foreground truncate text-xs">
                  {argsText(job) ||
                    (job.subjectType
                      ? `${job.subjectType} ${job.subjectId ?? ""}`
                      : "")}
                </span>
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
          hostSlug: {
            label: tr("jobs.col.host"),
            sortable: true,
            cell: (job) => (
              <span className="text-muted-foreground text-xs">
                {job.hostSlug ?? ""}
              </span>
            ),
          },
          status: {
            label: tr("jobs.col.status"),
            cell: (job) => <JobStatusBadge status={job.status} />,
          },
          duration: {
            label: tr("jobs.col.duration"),
            // Sorted on the time it ran (#Q4293); a job still running or
            // never started sorts as none.
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
          costUsd: {
            label: tr("jobs.col.cost"),
            // What the run cost, as its agent CLI said and Bay sent with
            // its end (#Q4293); blank for an older Bay.
            sortable: true,
            align: "right",
            cell: (job) => (
              <span
                className="text-muted-foreground text-xs tabular-nums"
                data-testid="job-cost"
              >
                {job.costUsd === undefined ? "" : `$${job.costUsd.toFixed(2)}`}
              </span>
            ),
          },
        }}
      />
    </div>
  );
};

/**
 * A job's args as a person says them: `#Q12 Fix the cart`, a member by name.
 */
const argsText = (job: HostJobResource): string =>
  (job.args ?? [])
    .map(
      (it) =>
        [it.reference, it.title].filter(Boolean).join(" ") ||
        (it.type === "member" ? "" : it.value),
    )
    .filter(Boolean)
    .join(", ");

/**
 * `1 min 12 s`, `45 s`, `2 h 3 min`: the job events' own reading.
 */
const durationText = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes} min ${s % 60} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};

export default ProjectSettingsPromptJobsPage;
