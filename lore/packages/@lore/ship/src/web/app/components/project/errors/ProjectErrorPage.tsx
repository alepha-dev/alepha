import {
  currentProjectAtom,
  hasCapability,
  type I18n,
  useRank,
} from "@lore/core/web";
import { useClient, useQuery, useQueryClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useCallback, useState } from "react";

import type { ProjectErrorController } from "../../../../../api/controllers/ProjectErrorController.ts";
import type { ProjectErrorDetail } from "../../../../../api/schemas/projectErrorDetailSchema.ts";
import ProjectErrorCounts from "./ProjectErrorCounts.tsx";
import ProjectErrorHeader from "./ProjectErrorHeader.tsx";
import ProjectErrorRail from "./ProjectErrorRail.tsx";
import ProjectErrorRulesDialog from "./ProjectErrorRulesDialog.tsx";
import ProjectErrorStack from "./ProjectErrorStack.tsx";
import ProjectErrorThread from "./ProjectErrorThread.tsx";
import ProjectErrorTrendChart from "./ProjectErrorTrendChart.tsx";
import { useProjectErrorVerbs } from "./useProjectErrorVerbs.ts";

export interface ProjectErrorPageProps {
  /**
   * The error as the route's loader read it. The page reads it again after
   * every verb, under the same query key.
   */
  detail: ProjectErrorDetail;
}

/**
 * One error, at `/:projectSlug/errors/:errorId` (#E185): everything Lore
 * knows about it and every triage verb, in the two-column shell of the
 * quest view. A main column (where it stands, what it is, its counts, its
 * thirty days, its stack, then its activity and discussion) and a rail (details, apps, linked error, quest,
 * ignore rules, the run or the monitor behind it).
 *
 * ⚠️ SECURITY: `name`, `message`, `stack` and `sourceUrl` are 100%
 * attacker-controlled. Every one is plain React text here and in the
 * components below: never markdown, never `dangerouslySetInnerHTML`, and
 * the page address is text, never a link.
 */
const ProjectErrorPage = (props: ProjectErrorPageProps) => {
  useI18n<I18n, "en">();
  // Untyped on purpose: the rail points at pages of Plan (`projectQuest`)
  // and of Requirements (`projectUseCase`), and Ship's own program registers
  // only Ship's and core's routers.
  const router = useRouter<any>();
  const [project] = useStore(currentProjectAtom);
  const api = useClient<ProjectErrorController>();
  const queries = useQueryClient();
  const { can } = useRank();
  const [ignoring, setIgnoring] = useState(false);

  const projectId = project?.id ?? 0;
  const projectSlug = project?.slug ?? "";
  const errorId = props.detail.error.id;

  // Seeded by the loader (`initialData`), read again when a verb
  // invalidates the key. Quiet on failure: the page keeps what it showed.
  const detail =
    useQuery(
      {
        key: ["project-error", projectId, errorId],
        enabled: !!project,
        initialData: props.detail,
        handler: () => api.getProjectError({ params: { projectId, errorId } }),
        onError: () => {},
      },
      [api, projectId, errorId],
    ).data ?? props.detail;

  // Beside the single read, never inside it: a chart that cannot be read
  // costs the chart, not the page.
  const trend = useQuery(
    {
      key: ["project-error-trend", projectId, errorId],
      enabled: !!project,
      handler: () =>
        api.getProjectErrorTrend({ params: { projectId, errorId } }),
      onError: () => {},
    },
    [api, projectId, errorId],
  ).data;

  const errorHref = (id: number) =>
    router.path("projectError", {
      params: { projectSlug, errorId: String(id) },
    });
  const inboxHref = router.path("projectErrors", { params: { projectSlug } });
  const questHref = (shortId: number) =>
    router.path("projectQuest", {
      params: { projectSlug, shortId: String(shortId) },
    });

  const refresh = useCallback(() => {
    queries.invalidate(["project-error", projectId, errorId]);
    queries.invalidate(["project-error-thread", projectId, errorId]);
  }, [queries, projectId, errorId]);

  const verbs = useProjectErrorVerbs({
    projectId,
    errorId,
    onChanged: refresh,
    onDeleted: () =>
      void router.push("projectErrors", { params: { projectSlug } }),
  });

  if (!project) return null;
  const canForward = hasCapability(project, "plan");

  return (
    // The quest view's shell: below `lg` one column that scrolls as a whole,
    // from `lg` a row where the main column scrolls and the rail stands.
    <div
      key={errorId}
      className="bg-background flex flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden"
      data-testid="error-page"
    >
      <div className="flex min-w-0 flex-1 flex-col overflow-x-clip lg:overflow-x-hidden lg:overflow-y-auto">
        <div className="flex flex-1 flex-col gap-6 px-4 pt-4 pb-14 lg:px-10">
          <ProjectErrorHeader
            detail={detail}
            verbs={verbs}
            inboxHref={inboxHref}
            errorHref={errorHref}
            canForward={canForward}
            onIgnore={() => setIgnoring(true)}
          />
          <ProjectErrorCounts detail={detail} />
          <ProjectErrorTrendChart trend={trend} />
          <ProjectErrorStack
            name={detail.error.name}
            message={detail.error.message}
            stack={detail.error.stack}
          />
          <ProjectErrorThread
            detail={detail}
            projectId={projectId}
            projectSlug={projectSlug}
            questHref={questHref}
            busy={verbs.busy}
            onTrust={verbs.canTriage ? () => void verbs.trust.run() : undefined}
            onForwardFinding={
              verbs.canTriage && canForward
                ? (commentId) => void verbs.forwardFinding.run(commentId)
                : undefined
            }
            // The job's page is Prompts' (`projectJob`), read with
            // `host:read`: without it the run is named and not linked.
            jobHref={
              can("host:read")
                ? (jobId) =>
                    router.path("projectJob", {
                      params: { projectSlug, jobId },
                    })
                : undefined
            }
            onRunEnded={refresh}
          />
        </div>
      </div>
      <aside
        className="border-border bg-muted/20 w-full shrink-0 border-t p-4 lg:w-[308px] lg:overflow-y-auto lg:border-t-0 lg:border-l"
        data-testid="error-rail"
      >
        <ProjectErrorRail
          detail={detail}
          verbs={verbs}
          canForward={canForward}
          onIgnore={() => setIgnoring(true)}
          hrefs={{
            app: (app, env) =>
              router.path("app", { params: { projectSlug, app, env } }),
            error: errorHref,
            quest: questHref,
            useCase: (number) =>
              router.path("projectUseCase", {
                params: { projectSlug, useCaseNumber: String(number) },
              }),
            monitor: (monitorId) =>
              router.path("projectMonitor", {
                params: { projectSlug, monitorId },
              }),
          }}
        />
      </aside>
      <ProjectErrorRulesDialog
        open={ignoring}
        projectId={projectId}
        initialPattern={detail.error.message}
        onOpenChange={(open) => {
          setIgnoring(open);
          // A rule added from here may match this error: its rail says so.
          if (!open) {
            queries.invalidate(["project-error", projectId, errorId]);
          }
        }}
      />
    </div>
  );
};

export default ProjectErrorPage;
