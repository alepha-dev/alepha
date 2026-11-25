import { Badge, cn, textLinkUnderlineClassName, TimeAgo } from "@alepha/ui";
import { DetailAside, type DetailAsideRow } from "@alepha/ui/shell";
import type { HostJobResource, PromptResource } from "@lore/core/schemas";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";

import JobStatusBadge from "./host-jobs/JobStatusBadge.tsx";

export interface ProjectPromptAsideProps {
  prompt: PromptResource;
  projectSlug: string;
  pages: Array<{ key: string; label: string }>;
  lastStatus?: HostJobResource["status"];
}

/**
 * A prompt's properties beside its words (#Q4326): its name and kind, what
 * its agent reads, its args, its trigger with its checks and whether it is
 * on, where it is pinned, and its last run with the job's link.
 */
const ProjectPromptAside = (props: ProjectPromptAsideProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { prompt } = props;
  const triggered = prompt.on !== "manual";
  const rows: DetailAsideRow[] = [
    { label: tr("prompts.field.name"), copy: prompt.name },
    {
      label: tr("prompts.source"),
      value: tr(`prompts.source.${prompt.source}`),
    },
    {
      label: tr("prompts.table.args"),
      value: prompt.args.length ? (
        <ul className="flex flex-col gap-0.5">
          {prompt.args.map((arg) => (
            <li key={arg.name}>
              <span className="font-mono">{`{{${arg.name}}}`}</span>{" "}
              {tr(`prompts.arg.${arg.type}`)}
              {arg.accepts?.length
                ? ` (${tr("prompts.accepts", { args: [arg.accepts.join(", ")] })})`
                : ""}
            </li>
          ))}
        </ul>
      ) : (
        tr("prompts.args.none")
      ),
    },
    {
      label: tr("prompts.table.trigger"),
      value: (
        <span
          data-testid="prompt-page-trigger"
          className={cn(
            triggered && !prompt.enabled && "text-muted-foreground",
          )}
        >
          {triggered ? prompt.on : tr("prompts.trigger.manual")}
          {prompt.check?.length
            ? ` · ${tr("prompts.trigger.checks", { args: [prompt.check.join(", ")] })}`
            : ""}
          {triggered && !prompt.enabled
            ? ` · ${tr("prompts.trigger.off")}`
            : ""}
        </span>
      ),
    },
    {
      label: tr("prompts.table.pins"),
      value: prompt.pins.length
        ? prompt.pins
            .map((key) =>
              tr(`prompts.page.${key}`, {
                default: props.pages.find((it) => it.key === key)?.label ?? key,
              }),
            )
            .join(", ")
        : tr("prompts.pins.none"),
    },
    {
      label: tr("prompts.table.lastRun"),
      value:
        prompt.lastJobId && prompt.lastRunAt ? (
          <span className="flex items-center gap-2">
            {props.lastStatus && <JobStatusBadge status={props.lastStatus} />}
            <Link
              href={`/${props.projectSlug}/jobs/${prompt.lastJobId}`}
              className={textLinkUnderlineClassName}
            >
              <TimeAgo value={prompt.lastRunAt} />
            </Link>
          </span>
        ) : (
          tr("prompts.never")
        ),
    },
  ];
  return (
    <DetailAside
      avatar={false}
      header={
        <div className="flex flex-col gap-2" data-testid="prompt-aside">
          <h1
            className="flex items-center gap-2 text-base leading-snug font-semibold"
            data-testid="prompt-page-title"
          >
            {prompt.title}
            {prompt.builtin && (
              <Badge variant="secondary">{tr("prompts.builtin")}</Badge>
            )}
          </h1>
          {prompt.description && (
            <p className="text-muted-foreground text-sm">
              {prompt.description}
            </p>
          )}
        </div>
      }
      rows={rows}
    />
  );
};

export default ProjectPromptAside;
