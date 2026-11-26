import { cn, textLinkUnderlineClassName } from "@alepha/ui";
import { DetailAside, type DetailAsideRow } from "@alepha/ui/shell";
import type {
  AgentTranscriptTotals,
  HostJobResource,
  PromptJobArg,
} from "@lore/core/schemas";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";

import JobStatusBadge from "./JobStatusBadge.tsx";

export interface ProjectJobAsideProps {
  job: HostJobResource;
  projectSlug: string;
  /**
   * The prompt's title, when the project still has it; a deleted custom
   * prompt shows its name, unlinked.
   */
  promptTitle?: string;
  totals?: AgentTranscriptTotals;
  /**
   * The model the agent CLI reported at its start, read from the
   * transcript (#Q4304): the Model row's last fallback, for a running job
   * the server has not named one for yet.
   */
  sessionModel?: string;
}

/**
 * The job's identity (#Q4286): titled by its prompt and args as a person
 * says them, its status and duration, the prompt it ran, and its facts as
 * rows. Hidden below `md`, as on every detail page: the Transcript tab
 * carries the status, the failure and the reply on its own.
 */
const ProjectJobAside = (props: ProjectJobAsideProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const { job } = props;
  const base = `/${props.projectSlug}` as const;
  const hrefOf = (arg: PromptJobArg): `/${string}` | undefined => {
    if (arg.type === "quest") return `${base}/quests/${arg.value}`;
    if (arg.type === "epic") return `${base}/epics/${arg.value}`;
    if (arg.type === "feedback")
      return `${base}/feedback?feedback=${arg.value}`;
    return undefined;
  };
  const title = job.prompt ? (props.promptTitle ?? job.prompt) : job.kind;
  const cause =
    job.cause?.kind === "event"
      ? tr("jobs.cause.event", { args: [job.cause.event ?? ""] })
      : job.cause?.kind === "schedule"
        ? tr("jobs.cause.schedule")
        : job.startedByName
          ? tr("jobs.cause.handBy", { args: [job.startedByName] })
          : tr("jobs.cause.hand");
  const seconds =
    job.startedAt && job.endedAt
      ? (Date.parse(job.endedAt) - Date.parse(job.startedAt)) / 1000
      : undefined;
  const row = (
    label: string,
    value: React.ReactNode | undefined,
  ): DetailAsideRow[] =>
    value === undefined || value === "" ? [] : [{ label, value }];
  const totals = props.totals;

  const rows: DetailAsideRow[] = [
    ...row(tr("jobs.col.cause"), cause),
    ...row(tr("jobs.field.host"), job.hostSlug),
    ...row(tr("jobs.field.agent"), job.input.agent),
    // The model that ran (#Q4304): the one the run named, else the one the
    // agent CLI reported, as the server reads it once the job ended or the
    // page reads it from the transcript meanwhile.
    ...row(
      tr("jobs.field.model"),
      job.input.model ?? job.model ?? props.sessionModel,
    ),
    ...row(tr("jobs.field.workspace"), job.input.workspace),
    ...row(
      tr("jobs.field.source"),
      job.input.source
        ? {
            none: tr("jobs.source.none"),
            read: tr("jobs.source.read"),
            write: tr("jobs.source.write"),
          }[job.input.source.mode]
        : undefined,
    ),
    ...row(tr("jobs.field.ref"), job.input.source?.ref),
    ...row(tr("jobs.field.branch"), job.input.source?.branch),
    ...row(tr("jobs.field.commit"), job.commit?.slice(0, 12)),
    ...row(tr("jobs.field.queued"), l(job.queuedAt, { date: "lll" })),
    ...row(
      tr("jobs.field.started"),
      job.startedAt ? l(job.startedAt, { date: "lll" }) : undefined,
    ),
    ...row(
      tr("jobs.field.ended"),
      job.endedAt ? l(job.endedAt, { date: "lll" }) : undefined,
    ),
    ...row(
      tr("jobs.field.exit"),
      job.exitCode === undefined ? undefined : String(job.exitCode),
    ),
    // Tokens first (#Q4502): what a run spent, whatever the host pays.
    ...row(
      tr("jobs.field.tokens"),
      totals?.inputTokens === undefined && totals?.outputTokens === undefined
        ? undefined
        : `${(totals?.inputTokens ?? 0).toLocaleString()} / ${(totals?.outputTokens ?? 0).toLocaleString()}`,
    ),
    ...row(
      tr("jobs.field.turns"),
      totals?.turns === undefined ? undefined : String(totals.turns),
    ),
    ...row(
      tr("jobs.field.cost"),
      totals?.costUsd === undefined
        ? undefined
        : `$${totals.costUsd.toFixed(2)}`,
    ),
    { label: tr("jobs.field.id"), copy: job.id },
  ];

  return (
    <DetailAside
      avatar={false}
      header={
        <div className="flex flex-col gap-2" data-testid="job-aside">
          <h1
            className="text-base leading-snug font-semibold"
            data-testid="job-title"
          >
            {title}{" "}
            {(job.args ?? []).map((arg) => {
              const text =
                [arg.reference, arg.title].filter(Boolean).join(" ") ||
                (arg.type === "member" ? "" : arg.value);
              if (!text) return null;
              const href = hrefOf(arg);
              return href ? (
                <Link
                  key={arg.name}
                  href={href}
                  className={cn(textLinkUnderlineClassName, "font-normal")}
                >
                  {text}
                </Link>
              ) : (
                <span key={arg.name} className="font-normal">
                  {text}
                </span>
              );
            })}
          </h1>
          <span className="flex items-center gap-2 text-sm">
            <JobStatusBadge status={job.status} />
            {seconds !== undefined && (
              <span className="text-muted-foreground tabular-nums">
                {durationText(seconds)}
              </span>
            )}
          </span>
          {job.prompt && (
            <span className="text-muted-foreground text-xs">
              {tr("jobs.runOf")}{" "}
              {props.promptTitle ? (
                <Link
                  href={`${base}/settings/prompts`}
                  className={textLinkUnderlineClassName}
                  data-testid="job-run-prompt"
                >
                  {props.promptTitle}
                </Link>
              ) : (
                <span data-testid="job-run-prompt">{job.prompt}</span>
              )}
            </span>
          )}
        </div>
      }
      rows={rows}
    />
  );
};

/**
 * `1 min 12 s`, `45 s`, `2 h 3 min`.
 */
const durationText = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes} min ${s % 60} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};

export default ProjectJobAside;
