import { cn, textLinkUnderlineClassName } from "@alepha/ui";
import { DataTable, type DataTableFilterFields } from "@alepha/ui/table";
import type { HostJobController } from "@lore/core/api";
import type { HostJobResource } from "@lore/core/schemas";
import { AgentJobStepper, type I18n, currentProjectAtom } from "@lore/core/web";
import { z } from "alepha";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { CircleDot, Server, Sparkles } from "lucide-react";
import { useState } from "react";

import type { PromptController } from "../../../../api/controllers/PromptController.ts";
import JobStatusBadge from "../host-jobs/JobStatusBadge.tsx";
import { argsText, durationText } from "../host-jobs/jobText.ts";

export interface PromptJobsTableProps {
  /**
   * The one prompt the table lists, always applied, its filter not drawn:
   * a prompt's own Jobs tab (#Q4355).
   */
  prompt?: string;
  /**
   * The prompt the prompt filter opens on, still changeable: Settings >
   * Prompts > Jobs opened from `?prompt=`.
   */
  seedPrompt?: string;
  className?: string;
}

/**
 * The project's prompt jobs (#Q4281), newest first, each with its prompt and
 * args, its cause, where it ran, how it ended and how long it took, filtered
 * by prompt, status and host on the table's own filter bar (#Q4305), each
 * offering what the loaded jobs hold, its tokens shown and its cost in the
 * column picker (#Q4502). Polled every few seconds while one is
 * in flight. Settings > Prompts > Jobs draws it whole; a prompt's page draws
 * it on that prompt, with no prompt filter (#Q4355).
 */
const PromptJobsTable = (props: PromptJobsTableProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const api = useClient<HostJobController>();
  const prompts = useClient<PromptController>();
  const [project] = useStore(currentProjectAtom);
  const [polling, setPolling] = useState(false);
  const fixed = props.prompt;
  const asked = props.seedPrompt;

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
  const jobs = (data?.items ?? []).filter(
    (it) => fixed === undefined || it.prompt === fixed,
  );
  const distinct = (values: Array<string | undefined>) =>
    [...new Set(values.filter((it): it is string => !!it))].sort((a, b) =>
      a.localeCompare(b),
    );
  const options = (values: string[], label = (it: string) => it) =>
    values.map((it) => ({ value: it, label: label(it) }));
  // On the bar from the start, each offering what the loaded jobs hold. The
  // prompt asked for by `?prompt=` is offered even before a job of it loads.
  const promptField = {
    prompt: {
      schema: z.text({ maxLength: 64 }),
      label: tr("jobs.col.prompt"),
      icon: Sparkles,
      mode: "default",
      items: options(
        distinct([
          ...jobs.map((it) => it.prompt),
          ...(asked !== undefined ? [asked] : []),
        ]),
        (name) => titleOf.get(name) ?? name,
      ),
      control: { clearLabel: tr("jobs.filter.allPrompts") },
    },
  } satisfies DataTableFilterFields;
  const filterFields = {
    // A prompt's own table has one prompt: no filter to pick it with.
    ...(fixed === undefined ? promptField : {}),
    status: {
      schema: z.text({ maxLength: 16 }),
      label: tr("jobs.col.status"),
      icon: CircleDot,
      mode: "default",
      column: "status",
      items: options(distinct(jobs.map((it) => it.status))),
      control: { clearLabel: tr("jobs.filter.allStatuses") },
    },
    host: {
      schema: z.text({ maxLength: 64 }),
      label: tr("jobs.col.host"),
      icon: Server,
      mode: "default",
      column: "hostSlug",
      items: options(distinct(jobs.map((it) => it.hostSlug))),
      control: { clearLabel: tr("jobs.filter.allHosts") },
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
    <DataTable<HostJobResource, typeof filterFields>
      className={props.className}
      flat
      data={jobs}
      filters={{
        fields: filterFields,
        // The Prompts tab's "Jobs" entry: `?prompt=<name>`.
        ...(asked !== undefined && fixed === undefined
          ? { seedValues: { prompt: asked } }
          : {}),
      }}
      // Exact, where the built-in matching takes a string as a substring:
      // `triage` must not also list `triage-errors`.
      filter={(job, values) => {
        // Without its prompt field on a prompt's own table.
        const filters = values as {
          prompt?: string;
          status?: string;
          host?: string;
        };
        return (
          (!filters.prompt || job.prompt === filters.prompt) &&
          (!filters.status || job.status === filters.status) &&
          (!filters.host || job.hostSlug === filters.host)
        );
      }}
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
          // Its steps under its status, compact (#Q4434): segments and
          // "4/7", riding on the list's own read.
          cell: (job) => (
            <span className="flex flex-col items-start gap-1">
              <JobStatusBadge status={job.status} />
              {job.steps && (
                <AgentJobStepper
                  compact
                  steps={job.steps}
                  {...(job.pace ? { pace: job.pace } : {})}
                  running={job.status === "running"}
                />
              )}
            </span>
          ),
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
        inputTokens: {
          label: tr("jobs.col.tokens"),
          // What a burst of heavy runs shows (#Q4502): the input tokens,
          // compact, the output beside them; blank for an older Bay.
          sortable: true,
          sortValue: (job) => job.inputTokens,
          align: "right",
          cell: (job) => (
            <span
              className="text-muted-foreground text-xs tabular-nums"
              data-testid="job-tokens"
              title={
                job.inputTokens === undefined && job.outputTokens === undefined
                  ? undefined
                  : tr("jobs.tokens.title", {
                      args: [
                        (job.inputTokens ?? 0).toLocaleString(),
                        (job.outputTokens ?? 0).toLocaleString(),
                      ],
                    })
              }
            >
              {job.inputTokens === undefined && job.outputTokens === undefined
                ? ""
                : `${tokensText(job.inputTokens ?? 0)} / ${tokensText(job.outputTokens ?? 0)}`}
            </span>
          ),
        },
        costUsd: {
          label: tr("jobs.col.cost"),
          // An estimate at API list prices, which a host signed in with a
          // subscription is never billed (#Q4502): in the column picker.
          defaultHidden: true,
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
  );
};

/**
 * A token count as a glance reads it: `950`, `12k`, `530k`, `1.2M`.
 */
const tokensText = (count: number): string => {
  const short = (value: number, unit: string) =>
    `${value < 10 ? Number(value.toFixed(1)) : Math.round(value)}${unit}`;
  if (count < 1000) return String(count);
  if (count < 999_500) return short(count / 1000, "k");
  return short(count / 1_000_000, "M");
};

export default PromptJobsTable;
