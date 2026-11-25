import { cn, textLinkUnderlineClassName } from "@alepha/ui";
import { MarkdownView } from "@alepha/ui/markdown";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";

import type { HostJobResource } from "../../../../../api/schemas/hostJobResourceSchema.ts";
import type { PromptJobArg } from "../../../../../api/schemas/promptJobArgSchema.ts";
import { type I18n } from "../../../services/I18n.ts";

export interface ProjectJobRunProps {
  job: HostJobResource;
  projectSlug: string;
  /**
   * The prompt's title, when the project still has it; a deleted custom
   * prompt shows its name, unlinked.
   */
  promptTitle?: string;
}

/**
 * What a run was (#Q4281): its prompt, linking to Settings > Prompts, its
 * args each linking to its item, its cause, the agent's final reply rendered
 * from Markdown, and the rendered prompt, folded. A job that ran no prompt
 * (an Agent host's check) shows nothing here.
 */
const ProjectJobRun = (props: ProjectJobRunProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { job, projectSlug } = props;
  if (!job.prompt) return null;
  const base = `/${projectSlug}` as const;
  const hrefOf = (arg: PromptJobArg): `/${string}` | undefined => {
    if (arg.type === "quest") return `${base}/quests/${arg.value}`;
    if (arg.type === "epic") return `${base}/epics/${arg.value}`;
    if (arg.type === "feedback")
      return `${base}/feedback?feedback=${arg.value}`;
    return undefined;
  };
  const cause =
    job.cause?.kind === "event"
      ? tr("jobs.cause.event", { args: [job.cause.event ?? ""] })
      : job.cause?.kind === "schedule"
        ? tr("jobs.cause.schedule")
        : job.startedByName
          ? tr("jobs.cause.handBy", { args: [job.startedByName] })
          : tr("jobs.cause.hand");

  return (
    <div
      className="flex shrink-0 flex-col gap-3 border-b px-4 py-3 text-sm"
      data-testid="job-run"
    >
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">{tr("jobs.col.prompt")}</dt>
        <dd className="min-w-0 truncate" data-testid="job-run-prompt">
          {props.promptTitle ? (
            <Link
              href={`${base}/settings/prompts`}
              className={textLinkUnderlineClassName}
            >
              {props.promptTitle}
            </Link>
          ) : (
            job.prompt
          )}
        </dd>
        {(job.args ?? []).length > 0 && (
          <>
            <dt className="text-muted-foreground">{tr("jobs.field.args")}</dt>
            <dd className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
              {(job.args ?? []).map((arg) => {
                const text =
                  [arg.reference, arg.title].filter(Boolean).join(" ") ||
                  (arg.type === "member"
                    ? tr("prompts.arg.member")
                    : arg.value);
                const href = hrefOf(arg);
                return href ? (
                  <Link
                    key={arg.name}
                    href={href}
                    className={cn(textLinkUnderlineClassName, "truncate")}
                  >
                    {text}
                  </Link>
                ) : (
                  <span key={arg.name} className="truncate">
                    {text}
                  </span>
                );
              })}
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">{tr("jobs.col.cause")}</dt>
        <dd className="min-w-0 truncate">{cause}</dd>
      </dl>
      {job.result && (
        <section className="flex flex-col gap-1" data-testid="job-reply">
          <h2 className="text-muted-foreground text-xs font-medium">
            {tr("jobs.field.reply")}
          </h2>
          <MarkdownView content={job.result} />
          {job.resultTruncated && (
            <p className="text-muted-foreground text-xs">
              {tr("jobs.field.replyCut")}
            </p>
          )}
        </section>
      )}
      {job.input.prompt && (
        <details className="text-xs">
          <summary className="text-muted-foreground cursor-pointer">
            {tr("jobs.field.renderedPrompt")}
          </summary>
          <pre className="bg-background mt-2 max-h-80 overflow-auto rounded border p-2 font-mono text-xs whitespace-pre-wrap">
            {job.input.prompt}
          </pre>
        </details>
      )}
    </div>
  );
};

export default ProjectJobRun;
