import {
  Badge,
  Button,
  cn,
  textLinkUnderlineClassName,
  TimeAgo,
} from "@alepha/ui";
import { formatReference, type I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";

import type { ProjectErrorDetail } from "../../../../../api/schemas/projectErrorDetailSchema.ts";
import { QUEST_STATUS_PREFIX } from "../../../../../api/schemas/projectErrorQuestStatus.ts";
import {
  ERROR_QUEST_STATUS_LABEL_KEYS,
  type ErrorQuestStatus,
} from "./errorQuestStatusLabelKeys.ts";
import ProjectErrorOriginBadge from "./ProjectErrorOriginBadge.tsx";
import ProjectErrorRailRow from "./ProjectErrorRailRow.tsx";
import ProjectErrorRailSection from "./ProjectErrorRailSection.tsx";
import ProjectErrorStatusBadge from "./ProjectErrorStatusBadge.tsx";
import { sigilNameParts } from "./sigilNameParts.ts";
import type { ProjectErrorVerbs } from "./useProjectErrorVerbs.ts";

export interface ProjectErrorRailProps {
  detail: ProjectErrorDetail;
  verbs: ProjectErrorVerbs;
  canForward: boolean;
  onIgnore: () => void;
  /**
   * Where each thing the rail points at lives. Built by the page, which
   * holds the router: an app's page, another error's, a quest's, a use
   * case's, a monitor's.
   */
  hrefs: {
    app: (app: string, env: string) => string;
    error: (id: number) => string;
    quest: (shortId: number) => string;
    useCase: (number: number) => string;
    monitor: (id: string) => string;
  };
}

/**
 * The right rail of an error's page: its details, the apps that reported
 * it, the error on the other side of its request, its quest, the ignore
 * rules that match, and where a run or an uptime error came from.
 *
 * A block with nothing to say is left out, never drawn empty: a monitor's
 * outage has no app, most errors have no linked error.
 *
 * ⚠️ SECURITY: `sourceUrl`, `route` and the rule patterns are text. The page
 * an error happened on is never a link: it came from an application's
 * runtime.
 */
const ProjectErrorRail = (props: ProjectErrorRailProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const { error, kind, apps, quest, rules, run, monitor } = props.detail;
  const verbs = props.verbs;
  const forwarded = error.status.startsWith(QUEST_STATUS_PREFIX);
  const linkClass = cn(textLinkUnderlineClassName, "hover:text-foreground");
  const questStatusKey =
    quest?.status && quest.status in ERROR_QUEST_STATUS_LABEL_KEYS
      ? ERROR_QUEST_STATUS_LABEL_KEYS[quest.status as ErrorQuestStatus]
      : undefined;

  return (
    <div className="flex flex-col gap-3">
      <ProjectErrorRailSection
        title={tr("errors.rail.details")}
        testId="error-rail-details"
      >
        <ProjectErrorRailRow label={tr("errors.rail.status")}>
          <ProjectErrorStatusBadge status={error.status} showOpen />
        </ProjectErrorRailRow>
        <ProjectErrorRailRow label={tr("errors.rail.origin")}>
          <ProjectErrorOriginBadge origin={error.origin} kind={kind} />
        </ProjectErrorRailRow>
        <ProjectErrorRailRow
          label={tr("errors.rail.trust")}
          testId="error-rail-trust"
        >
          {!error.trustedAt ? (
            tr("errors.trust.awaiting")
          ) : !error.trustedBy ? (
            tr("errors.trust.onArrival")
          ) : (
            <span className="flex flex-col items-end">
              <span>
                {tr("errors.trustedBy", {
                  args: [error.trustedByName ?? ""],
                })}
              </span>
              <TimeAgo
                value={error.trustedAt}
                className="text-muted-foreground font-normal"
              />
            </span>
          )}
        </ProjectErrorRailRow>
        <ProjectErrorRailRow label={tr("errors.counts.firstSeen")}>
          {l(error.firstSeenAt, { date: "lll" })}
        </ProjectErrorRailRow>
        <ProjectErrorRailRow label={tr("errors.counts.lastSeen")}>
          {l(error.lastSeenAt, { date: "lll" })}
        </ProjectErrorRailRow>
        <ProjectErrorRailRow label={tr("errors.col.page")}>
          {error.sourceUrl || undefined}
        </ProjectErrorRailRow>
        <ProjectErrorRailRow label={tr("errors.rail.route")}>
          {error.route}
        </ProjectErrorRailRow>
        <ProjectErrorRailRow label={tr("errors.rail.fingerprint")}>
          <span className="font-mono font-normal" title={error.fingerprint}>
            {error.fingerprint.slice(0, 16)}
          </span>
        </ProjectErrorRailRow>
      </ProjectErrorRailSection>

      {kind === "sigil" && apps.length > 0 && (
        <ProjectErrorRailSection
          title={tr("errors.rail.apps")}
          testId="error-rail-apps"
        >
          {apps.map((app) => {
            // A sigil whose name is no `app/env` pair has no page to open.
            const parts = app.label.includes("/")
              ? sigilNameParts(app.label)
              : undefined;
            return (
              <div
                key={app.sigilId}
                className="flex items-center justify-between gap-3 py-1.5 text-xs"
                data-testid="error-rail-app"
              >
                {parts ? (
                  <Link
                    href={props.hrefs.app(parts.app, parts.env)}
                    className={cn(linkClass, "block min-w-0 truncate")}
                  >
                    {app.label}
                  </Link>
                ) : (
                  <span className="min-w-0 truncate">{app.label}</span>
                )}
                <span className="shrink-0 font-medium tabular-nums">
                  {l(app.count)}
                </span>
              </div>
            );
          })}
        </ProjectErrorRailSection>
      )}

      {error.linkedError && (
        <ProjectErrorRailSection
          title={tr("errors.rail.linked")}
          testId="error-rail-linked"
        >
          <Link
            href={props.hrefs.error(error.linkedError.id)}
            className={cn(linkClass, "py-1.5 text-xs")}
          >
            {tr(
              error.linkedError.origin === "server"
                ? "errors.linked.causedBy"
                : "errors.linked.caused",
              { args: [String(error.linkedError.id)] },
            )}
          </Link>
        </ProjectErrorRailSection>
      )}

      {/* The quest it was forwarded to, or the two ways to forward it. A
          forwarded error whose quest the caller cannot be shown (Plan off,
          no read on quests) says nothing more than its status above. */}
      {quest ? (
        <ProjectErrorRailSection
          title={tr("errors.rail.quest")}
          testId="error-rail-quest"
        >
          <div className="flex items-center justify-between gap-3 py-1.5 text-xs">
            <Link
              href={props.hrefs.quest(quest.shortId)}
              className={cn(linkClass, "block min-w-0 truncate")}
            >
              {formatReference("quest", quest.shortId)} {quest.title}
            </Link>
            {questStatusKey && (
              <Badge variant="secondary" className="shrink-0">
                {tr(questStatusKey)}
              </Badge>
            )}
          </div>
        </ProjectErrorRailSection>
      ) : (
        !forwarded &&
        error.status === "open" &&
        verbs.canTriage &&
        props.canForward && (
          <ProjectErrorRailSection
            title={tr("errors.rail.quest")}
            testId="error-rail-quest"
          >
            <div className="flex flex-col gap-1.5 py-1">
              <Button
                variant="outlined"
                size="sm"
                disabled={verbs.busy}
                onClick={() => void verbs.forward.run()}
              >
                {tr("errors.action.forwardNew")}
              </Button>
              <Button
                variant="outlined"
                size="sm"
                disabled={verbs.busy}
                onClick={() => void verbs.link.run()}
              >
                {tr("errors.action.forwardExisting")}
              </Button>
            </div>
          </ProjectErrorRailSection>
        )
      )}

      {(rules.length > 0 || verbs.canTriage) && (
        <ProjectErrorRailSection
          title={tr("errors.rules.title")}
          testId="error-rail-rules"
        >
          {rules.map((rule) => (
            <span
              key={rule.id}
              className="py-1 font-mono text-xs break-words"
              data-testid="error-rail-rule"
            >
              {rule.pattern}
            </span>
          ))}
          {verbs.canTriage && (
            <Button
              variant="minimal"
              size="sm"
              className="-ml-2 self-start"
              onClick={props.onIgnore}
              data-testid="error-rail-ignore"
            >
              {tr("errors.action.ignore")}
            </Button>
          )}
        </ProjectErrorRailSection>
      )}

      {kind === "run" && run && (
        <ProjectErrorRailSection
          title={tr("errors.rail.run")}
          testId="error-rail-run"
        >
          <ProjectErrorRailRow label={tr("errors.rail.useCase")}>
            {run.useCase && (
              <Link
                href={props.hrefs.useCase(run.useCase.number)}
                className={linkClass}
              >
                {run.useCase.title}
              </Link>
            )}
          </ProjectErrorRailRow>
          <ProjectErrorRailRow label={tr("errors.rail.criterion")}>
            {run.criterionKey}
          </ProjectErrorRailRow>
          <ProjectErrorRailRow label={tr("errors.rail.runNumber")}>
            {run.useCaseRunId === undefined
              ? undefined
              : String(run.useCaseRunId)}
          </ProjectErrorRailRow>
        </ProjectErrorRailSection>
      )}

      {kind === "uptime" && monitor && (
        <ProjectErrorRailSection
          title={tr("errors.origin.monitor")}
          testId="error-rail-monitor"
        >
          <Link
            href={props.hrefs.monitor(monitor.id)}
            className={cn(linkClass, "py-1.5 text-xs")}
          >
            {tr("errors.rail.openMonitor")}
          </Link>
        </ProjectErrorRailSection>
      )}
    </div>
  );
};

export default ProjectErrorRail;
