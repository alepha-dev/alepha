import { cn, textLinkUnderlineClassName } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { DataTable } from "@alepha/ui/table";
import { z } from "alepha";
import { useClient, useQuery, useStore } from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { useState } from "react";

import type { HostJobController } from "../../../../../api/controllers/HostJobController.ts";
import type { PromptController } from "../../../../../api/controllers/PromptController.ts";
import type { HostJobResource } from "../../../../../api/schemas/hostJobResourceSchema.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { type I18n } from "../../../services/I18n.ts";
import JobStatusBadge from "../host-jobs/JobStatusBadge.tsx";

const ALL = "";

/**
 * Settings > Prompts > Jobs (#Q4281): the project's jobs, newest first, each
 * with its prompt and args, its cause, where it ran, how it ended and how
 * long it took, filtered by prompt, status and host. A job belongs to the
 * project, not to a host: no host page lists them. `?prompt=` opens it
 * filtered on one prompt, the Prompts tab's "Jobs" entry. Polled every few
 * seconds while one is in flight.
 */
const ProjectSettingsPromptJobsPage = () => {
  const { tr, l } = useI18n<I18n, "en">();
  const api = useClient<HostJobController>();
  const prompts = useClient<PromptController>();
  const router = useRouter();
  const [project] = useStore(currentProjectAtom);
  const [polling, setPolling] = useState(false);
  const asked = (router.query as Record<string, unknown>).prompt;

  const form = useForm({
    schema: z.object({
      prompt: z.text({ maxLength: 64 }).optional(),
      status: z.text({ maxLength: 16 }).optional(),
      host: z.text({ maxLength: 64 }).optional(),
    }),
    initialValues: {
      prompt: typeof asked === "string" ? asked : ALL,
      status: ALL,
      host: ALL,
    },
    handler: () => undefined,
  });
  const filter = useFormValues(form);

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
  const shown = jobs.filter(
    (job) =>
      (!filter.prompt || job.prompt === filter.prompt) &&
      (!filter.status || job.status === filter.status) &&
      (!filter.host || job.hostSlug === filter.host),
  );
  const distinct = (values: Array<string | undefined>) =>
    [...new Set(values.filter((it): it is string => !!it))].sort((a, b) =>
      a.localeCompare(b),
    );
  const items = (values: string[], label = (it: string) => it) => [
    { value: ALL, label: tr("jobs.filter.all") },
    ...values.map((it) => ({ value: it, label: label(it) })),
  ];
  const input = form.input;
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
      <form
        {...form.props}
        className="chrome border-border flex flex-wrap gap-3 border-b px-4 py-3 md:px-6"
      >
        <div className="w-56">
          <Control
            input={input.prompt}
            label={tr("jobs.col.prompt")}
            select
            items={items(
              distinct([
                ...jobs.map((it) => it.prompt),
                ...(typeof asked === "string" ? [asked] : []),
              ]),
              (name) => titleOf.get(name) ?? name,
            )}
          />
        </div>
        <div className="w-40">
          <Control
            input={input.status}
            label={tr("jobs.col.status")}
            select
            items={items(distinct(jobs.map((it) => it.status)))}
          />
        </div>
        <div className="w-48">
          <Control
            input={input.host}
            label={tr("jobs.col.host")}
            select
            items={items(distinct(jobs.map((it) => it.hostSlug)))}
          />
        </div>
      </form>
      <DataTable<HostJobResource>
        className="min-h-0 flex-1"
        flat
        data={shown}
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
