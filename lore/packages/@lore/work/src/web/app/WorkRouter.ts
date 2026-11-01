import { type ReportsUrl, reportsUrlSchema } from "@lore/core/schemas";
import {
  $pageProject,
  $pageProjectSettings,
  currentProjectAtom,
  CoreRouter,
  hasCapability,
  canInProject,
  ProjectPageSkeleton,
  RedirectPage,
  ReportsTabRegistry,
  ReportsUrlQuery,
} from "@lore/core/web";
import { $inject, Alepha, z } from "alepha";
import { $page, NotFound, Redirection } from "alepha/react/router";
import { isHttpError, NotFoundError } from "alepha/server";
import { $client } from "alepha/server/links";
import { createElement } from "react";

import type { AreaController } from "../../api/controllers/AreaController.ts";
import type { EpicController } from "../../api/controllers/EpicController.ts";
import type { FeedbackController } from "../../api/controllers/FeedbackController.ts";
import type { ProjectReportsController } from "../../api/controllers/ProjectReportsController.ts";
import type { QuestController } from "../../api/controllers/QuestController.ts";
import type { RoadmapController } from "../../api/controllers/RoadmapController.ts";
import { currentEpicAtom } from "./atoms/currentEpicAtom.ts";
import { currentQuestAtom } from "./atoms/currentQuestAtom.ts";
import { roadmapNotFoundAtom } from "./atoms/roadmapNotFoundAtom.ts";
import { FEEDBACK_PAGE_SIZE } from "./components/project/feedback/feedbackPageSize.ts";

/**
 * Work's pages (#E75): quests, the board, epics, releases, the roadmap, feedback, the Work settings tabs and Reports' Overview, Quests and Members tabs.
 * Each page mounts under core with `$pageProject` or `parent:`, so no
 * router names another module's page.
 */
export class WorkRouter {
  core = $inject(CoreRouter);
  alepha = $inject(Alepha);
  questApi = $client<QuestController>();
  projectReportsApi = $client<ProjectReportsController>();
  reportsUrl = $inject(ReportsUrlQuery);
  reportsTabs = $inject(ReportsTabRegistry);
  feedbackApi = $client<FeedbackController>();
  epicApi = $client<EpicController>();
  areaApi = $client<AreaController>();
  // The framework's inbox, not a Lore controller: the read side of the
  // notification channel lives in `alepha/api/notifications`.
  roadmapApi = $client<RoadmapController>();
  /**
   * The quest list.
   *
   * ⚠️ **Moved off `/` when Activity took the project root.** It sits at
   * `/quests`, which also makes it consistent with `projectQuest` at
   * `/quests/:shortId` - a SIBLING, not a child, so no quest deep link
   * moved with it. Every caller reaches this page by NAME
   * (`router.path("projectQuests", …)`), so the path change touched no
   * call site; a bare `/:projectSlug` bookmark now lands on Activity.
   */
  projectQuests = $pageProject({
    path: "/quests",
    schema: {
      /**
       * The quests table's filters, seeded from the URL on arrival — the
       * drill-through target for a dashboard card, and for any link that
       * wants to open one slice of the backlog. `?status=todo&tag=need-answer`
       * opens the list already narrowed, and the toolbar's Share item is what
       * produces such a link.
       *
       * Multi-value filters are comma-joined (`?status=todo,in_progress`), the
       * same spelling `getQuests` takes on the wire, because
       * `parseQueryString` returns one value per key and a repeated param
       * keeps only the last.
       *
       * ⚠️ **One-directional, and it has to stay that way.** The URL seeds
       * the filter on entry; the filter NEVER writes back. `?view=kanban`
       * was removed for exactly this (#156): an effect that restored a
       * missing param keyed on `useRouterState`, which is a global store, so
       * the outgoing render on the way *out* of the page saw the next
       * route's empty query and bounced the user straight back. Every
       * sidebar link was dead. A page cannot tell "nobody has chosen yet"
       * from "we are leaving" while the state lives in the URL — so nothing
       * here may reintroduce a write-back.
       *
       * ⚠️ Typed as free text, not the status enum, and not as arrays. A
       * schema that rejects an unknown value turns a stale bookmark into an
       * error page; DataTable decodes each param against the table's own
       * filter schema and drops what it refuses, so a bad value degrades to
       * the unfiltered list.
       */
      query: z.object({
        status: z.text().optional(),
        search: z.text().optional(),
        area: z.text().optional(),
        tag: z.text().optional(),
        release: z.text().optional(),
      }),
    },
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Quests`,
    }),
    lazy: () => import("./components/project/ProjectQuestsTable.tsx"),
    // ⚠️ The loader GATES and fetches nothing. It used to redirect to
    // `/kanban` when the project's `defaultSurface` said so; the setting is
    // gone (feedback #2066), and the prohibition is unchanged: a bare
    // `/:projectSlug` lands on `projectDashboard` and nothing may send a
    // project URL anywhere, because a redirect there is the shape #156 was
    // about. What it does now is the capability check every capability's
    // landing route carries - see `projectFolios` for the rule.
    loader: async () => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!project) {
        throw new NotFoundError("Project not found");
      }
      if (!hasCapability(project, "work")) {
        throw new NotFoundError("Work is not enabled for this project");
      }
      // ⚠️ A permission NAME, and a module-level function rather than
      // `useRank()`: a `$page` loader runs outside React and cannot call a
      // hook, and the loader and the component must not disagree about which
      // pages exist. Same arrangement as `hasCapability` beside it.
      //
      // 404 rather than 403, matching the capability guard above it: a page
      // the reader may not open is a page that does not exist for them, and a
      // 403 would confirm what is behind it.
      if (!canInProject(project, "quest:read")) {
        throw new NotFoundError("Your rank does not open quests here");
      }
    },
  });

  /**
   * The Kanban board as a destination rather than a mode.
   *
   * ⚠️ Sibling of `projectQuests`, which sits at `/quests` - it has not held
   * `path: "/"` since Activity took the project root, and the root is the
   * dashboard's now. Giving the board a real route is what lets it have a
   * sidebar entry, a linkable URL and addressable cards.
   */
  projectKanban = $pageProject({
    name: "projectKanban",
    children: () => [this.projectKanbanCard],
    path: "/kanban",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Kanban`,
    }),
    // No loader: `ProjectKanbanPage` fetches the board itself, because the
    // board reloads in place when the header creates a quest and the loader
    // machinery does not re-run for that.
    lazy: () => import("./components/project/ProjectKanbanPage.tsx"),
  });

  projectQuest = $pageProject({
    loading: ProjectPageSkeleton,
    path: "/quests/:shortId",
    schema: {
      params: z.object({
        shortId: z.integer(),
      }),
    },
    head: (props, previous) => {
      const questTitle = (props as { quest?: { title?: string } } | undefined)
        ?.quest?.title;
      return {
        title: `${previous?.title ?? ""} › ${questTitle ?? "Quest"}`,
      };
    },
    lazy: () => import("./components/project/quest/QuestView.tsx"),
    /**
     * A card opens as a sheet over the board, which stays mounted and does not
     * refetch, and a reload of it is this page. It used to be a local
     * `setSelectedQuest`, which had no URL and, the part that actually bit, no
     * refetch: a long-lived board edited whatever `getBoard` returned however
     * long ago. The loader below gets fresh data on open for free.
     *
     * The board reads `currentQuestAtom`, which that loader seeds, to patch its
     * own row.
     */
    overlay: {
      over: () => [this.projectKanban],
      lazy: () => import("./components/project/ProjectKanbanCard.tsx"),
    },
    loader: async ({ params }) => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!project) {
        throw new NotFoundError("Project not found");
      }
      const quest = await this.questApi.getQuestByShortId({
        params: {
          projectId: project.id,
          shortId: params.shortId,
        },
      });
      this.alepha.store.set(currentQuestAtom, quest);
      return { quest };
    },
    onLeave: () => {
      this.alepha.store.set(currentQuestAtom, undefined);
    },
    errorHandler: (error) => {
      if (isHttpError(error, 404)) {
        return createElement(NotFound, { style: { height: "100%" } });
      }
    },
  });

  // Quest dependency graph page (Lore #98). Focused quest's connected
  // `dependsOn` component, laid out client-side, loaded once on mount.
  /**
   * One quest's questline: the `dependsOn` component it sits in, drawn with
   * the same `Questline` map the epic's Flow tab uses.
   *
   * ⚠️ **A quest inside an epic never renders here.** Its questline is the
   * epic's, and the epic's Flow tab already draws it beside that epic's own
   * chrome, so the loader redirects there rather than showing a second,
   * lonelier copy of the same map. The route survives for the quests that
   * belong to no epic, which are the ones with nowhere else to be drawn.
   *
   * The redirect is decided by `getQuestline`, in the same call that fetches
   * the component - the fork cannot be decided client-side, and answering it
   * in a second round trip would mean a page that renders and then navigates
   * away.
   *
   * The path keeps `/graph`. It is a link people already hold, and the page
   * behind it still answers the question that name asks.
   */
  projectQuestGraph = $pageProject({
    name: "projectQuestGraph",
    path: "/quests/:shortId/graph",
    schema: {
      params: z.object({
        shortId: z.integer(),
      }),
    },
    head: (props, previous) => {
      const quest = (props as { quest?: { title?: string } } | undefined)
        ?.quest;
      return {
        title: `${previous?.title ?? ""} › ${quest?.title ?? "Quest"} › Questline`,
      };
    },
    lazy: () => import("./components/project/quest/QuestQuestline.tsx"),
    loader: async ({ params }) => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!project) {
        throw new NotFoundError("Project not found");
      }
      const { epic, quests } = await this.questApi.getQuestline({
        params: {
          projectId: project.id,
          shortId: params.shortId,
        },
      });

      if (epic) {
        // `?tab=flow` is what `useDetailTab` reads on the epic page, so this
        // lands on the Flow tab rather than the epic's default one.
        throw new Redirection({
          redirect: `/${project.slug}/epics/${epic.number}?tab=flow`,
        });
      }

      // The focus quest is in the component by construction - it is the
      // quest the walk started from - so the head needs no second fetch.
      const quest = quests.find((q) => q.shortId === params.shortId);
      return { quest, quests };
    },
    errorHandler: (error) => {
      if (isHttpError(error, 404)) {
        return createElement(NotFound, { style: { height: "100%" } });
      }
    },
  });

  projectEpics = $pageProject({
    name: "projectEpics",
    path: "/epics",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Epics`,
    }),
    // No loader: `ProjectEpics` is a DataTable, which owns its own
    // fetch (filters, sort and page are its state, not the route's). A
    // loader here would fetch the list a second time and then have it
    // discarded on mount. Same arrangement as `projectBlights`.
    lazy: () => import("./components/project/epics/ProjectEpics.tsx"),
  });

  projectEpic = $pageProject({
    loading: ProjectPageSkeleton,
    name: "projectEpic",
    // `epicNumber`, NOT `number`: route params must be unique across the
    // whole route table, or two routes with different param names at the
    // same path position silently lose the inner value.
    path: "/epics/:epicNumber",
    schema: {
      params: z.object({
        epicNumber: z.integer(),
      }),
    },
    head: (props, previous) => {
      const epic = (props as { epic?: { title?: string } } | undefined)?.epic;
      return {
        title: `${previous?.title ?? ""} › ${epic?.title ?? "Epic"}`,
      };
    },
    lazy: () => import("./components/project/epics/ProjectEpic.tsx"),
    loader: async ({ params }) => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!project) {
        throw new NotFoundError("Project not found");
      }
      const epic = await this.epicApi.getEpicByNumber({
        params: { projectId: project.id, number: params.epicNumber },
      });
      // The breadcrumb leaf lives in `ProjectView`, the layout above this
      // route, which can only see `epicNumber`. See `currentEpicAtom`.
      this.alepha.store.set(currentEpicAtom, epic);
      return { epic };
    },
    onLeave: () => {
      this.alepha.store.set(currentEpicAtom, undefined);
    },
    errorHandler: (error) => {
      if (isHttpError(error, 404)) {
        return createElement(NotFound, { style: { height: "100%" } });
      }
    },
  });

  projectReleases = $pageProject({
    path: "/releases",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Releases`,
    }),
    lazy: () => import("./components/project/releases/ProjectReleases.tsx"),
  });

  projectRelease = $pageProject({
    name: "projectRelease",
    // `releaseTag`, NOT `tag` and NOT `number`: route params must be unique
    // across the whole route table, or two routes with different param names
    // at the same path position silently lose the inner value. Same trap
    // `projectEpic`'s `epicNumber` documents.
    //
    // Addressed by the TAG rather than the number because
    // `/alepha/releases/0.28.0` is what the URL is for, and the tag is
    // already unique per project. `releaseTagSchema` makes it URL-safe by
    // construction; `number` stays the stable internal reference and the
    // sort key, it is simply not what addresses the page.
    path: "/releases/:releaseTag",
    schema: {
      params: z.object({
        releaseTag: z.string(),
      }),
    },
    head: (_props, previous) => ({
      // The tag is not in `props`: with no loader there is nothing to hand
      // the component, and `head` is fed the loader's result too. The page
      // reads the param from the router state instead.
      title: `${previous?.title ?? ""} › Release`,
    }),
    // No loader: the project route already holds every release with its
    // rollup in `currentReleasesAtom`, so the page resolves the tag from
    // there. A loader would fetch what is already in the store.
    lazy: () => import("./components/project/releases/ProjectRelease.tsx"),
  });

  projectFeedback = $pageProject({
    name: "projectFeedback",
    path: "/feedback",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Feedback`,
    }),
    lazy: () => import("./components/project/feedback/ProjectFeedback.tsx"),
    loader: async () => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!project) {
        throw new NotFoundError("Project not found");
      }
      if (!hasCapability(project, "support")) {
        throw new NotFoundError("Support is not enabled for this project");
      }
      // ⚠️ A permission NAME, and a module-level function rather than
      // `useRank()`: a `$page` loader runs outside React and cannot call a
      // hook, and the loader and the component must not disagree about which
      // pages exist. Same arrangement as `hasCapability` beside it.
      //
      // 404 rather than 403, matching the capability guard above it: a page
      // the reader may not open is a page that does not exist for them, and a
      // 403 would confirm what is behind it.
      if (!canInProject(project, "feedback:read")) {
        throw new NotFoundError(
          "Your rank does not open the feedback inbox here",
        );
      }
      // The first page only. `Show more` fetches the rest from inside the
      // page, so the loader is one screenful regardless of inbox size.
      const { items, hasMore } = await this.feedbackApi.listFeedback({
        params: { projectId: project.id },
        query: { status: "pending", limit: FEEDBACK_PAGE_SIZE },
      });
      return { items, hasMore };
    },
  });

  projectSettingsAreas = $pageProjectSettings({
    name: "projectSettingsAreas",
    path: "/areas",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Areas`,
    }),
    lazy: () =>
      import("./components/project/settings/ProjectSettingsAreasPage.tsx"),
    loader: async () => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!project) {
        throw new NotFoundError("Project not found");
      }
      const areas = await this.areaApi.getAreas({
        params: { projectId: project.id },
      });
      return { areas };
    },
  });

  /**
   * The param is `areaId`, NOT the area's name: area names contain
   * slashes (`@alepha/ui`, `alepha/api/users`) and a path segment cannot
   * hold one. Route params must also be unique across the whole route
   * table — two routes with different param names at the same position
   * silently lose the inner value.
   */
  projectSettingsArea = $pageProjectSettings({
    name: "projectSettingsArea",
    path: "/areas/:areaId",
    schema: {
      params: z.object({ areaId: z.integer() }),
    },
    head: (props, previous) => {
      const area = (props as { area?: { name?: string } } | undefined)?.area;
      return {
        title: `${previous?.title ?? ""} › ${area?.name ?? "Area"}`,
      };
    },
    lazy: () =>
      import("./components/project/settings/ProjectSettingsAreaPage.tsx"),
    loader: async ({ params }) => {
      const area = await this.areaApi.getArea({
        params: { id: params.areaId },
      });
      return { area };
    },
    // A deleted or foreign area is a 404, like the sibling detail routes,
    // not the generic error page.
    errorHandler: (error) => {
      if (isHttpError(error, 404)) {
        return createElement(NotFound, { style: { height: "100%" } });
      }
    },
  });

  /**
   * The capability pages: each one's Features tab, the options that change
   * how it behaves. The masters and the options that add a sidebar entry are
   * on `projectSettingsCapabilities` since #Q2565, and Support, which has no
   * option, lost its page there.
   *
   * ⚠️ **`$page` renames are not typecheck-protected.**
   * `projectSettingsSections.ts` carries these names as plain strings, and
   * `app-routes.spec.ts` is what turns a missed one into a red test rather
   * than a dead link.
   */
  projectSettingsWork = $pageProjectSettings({
    name: "projectSettingsWork",
    path: "/work",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Quests`,
    }),
    lazy: () =>
      import("./components/project/settings/ProjectSettingsWorkPage.tsx"),
  });

  /**
   * Quests > Board: the kanban columns. Its tab is listed while the `board`
   * option is on; the route is not guarded, like every settings route.
   */
  projectSettingsBoard = $pageProjectSettings({
    name: "projectSettingsBoard",
    path: "/work/board",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Board`,
    }),
    lazy: () =>
      import("./components/project/settings/ProjectSettingsBoardPage.tsx"),
  });

  /**
   * Where a card opened on the board used to live, for the links people hold.
   * A card is `projectQuest` now, as a sheet over the board.
   *
   * From a loader, because `redirect:` is a static string and cannot carry
   * `:shortId`.
   */
  projectKanbanCard = $page({
    name: "projectKanbanCard",
    path: "/:shortId",
    schema: {
      params: z.object({
        shortId: z.integer(),
      }),
    },
    component: RedirectPage,
    // Annotated `Promise<void>` because it always throws.
    loader: async ({ params }): Promise<void> => {
      throw new Redirection({
        redirect: `/${this.alepha.store.get(currentProjectAtom)?.slug ?? ""}/quests/${params.shortId}`,
      });
    },
  });

  /**
   * The query `route` reads: the URL, narrowed to the filters the tab declares.
   */
  protected reportsQuery(route: string, url: ReportsUrl) {
    return this.reportsUrl.toQuery(url, this.reportsTabs.honours(route));
  }

  reportsFlow = $page({
    parent: this.core.projectReports,
    name: "reportsFlow",
    path: "/flow",
    schema: { query: reportsUrlSchema },
    lazy: () => import("./components/project/reports/ReportsFlow.client.tsx"),
    loader: async ({ query }) => ({
      url: query,
      flow: await this.projectReportsApi.getReportsFlow({
        params: {
          id: this.alepha.store.get(currentProjectAtom)?.id ?? -1,
        },
        query: this.reportsQuery("reportsFlow", query),
      }),
    }),
  });

  reportsBacklog = $page({
    parent: this.core.projectReports,
    name: "reportsBacklog",
    path: "/backlog",
    schema: { query: reportsUrlSchema },
    lazy: () =>
      import("./components/project/reports/ReportsBacklog.client.tsx"),
    loader: async ({ query }) => ({
      url: query,
      backlog: await this.projectReportsApi.getReportsBacklog({
        params: {
          id: this.alepha.store.get(currentProjectAtom)?.id ?? -1,
        },
        query: this.reportsQuery("reportsBacklog", query),
      }),
    }),
  });

  reportsPlanning = $page({
    parent: this.core.projectReports,
    name: "reportsPlanning",
    path: "/planning",
    schema: { query: reportsUrlSchema },
    lazy: () =>
      import("./components/project/reports/ReportsPlanning.client.tsx"),
    loader: async ({ query }) => ({
      planning: await this.projectReportsApi.getReportsPlanning({
        params: {
          id: this.alepha.store.get(currentProjectAtom)?.id ?? -1,
        },
        query: this.reportsQuery("reportsPlanning", query),
      }),
    }),
  });

  reportsSupport = $page({
    parent: this.core.projectReports,
    name: "reportsSupport",
    path: "/support",
    schema: { query: reportsUrlSchema },
    lazy: () =>
      import("./components/project/reports/ReportsSupport.client.tsx"),
    loader: async ({ query }) => ({
      support: await this.projectReportsApi.getReportsSupport({
        params: {
          id: this.alepha.store.get(currentProjectAtom)?.id ?? -1,
        },
        query: this.reportsQuery("reportsSupport", query),
      }),
    }),
  });

  reportsTeam = $page({
    parent: this.core.projectReports,
    name: "reportsTeam",
    path: "/team",
    schema: { query: reportsUrlSchema },
    lazy: () => import("./components/project/reports/ReportsTeam.client.tsx"),
    loader: async ({ query }) => ({
      team: await this.projectReportsApi.getReportsTeam({
        params: {
          id: this.alepha.store.get(currentProjectAtom)?.id ?? -1,
        },
        query: this.reportsQuery("reportsTeam", query),
      }),
    }),
  });

  // The Quests and Members tabs became Backlog and Team (#Q3016). The routes
  // stay for the links people hold, like `reportsQuality`.
  reportsQuests = $page({
    parent: this.core.projectReports,
    name: "reportsQuests",
    path: "/quests",
    component: RedirectPage,
    // Annotated `Promise<void>` because it always throws.
    loader: async (): Promise<void> => {
      throw new Redirection({
        redirect: `/${this.alepha.store.get(currentProjectAtom)?.slug ?? ""}/reports/backlog`,
      });
    },
  });

  reportsMembers = $page({
    parent: this.core.projectReports,
    name: "reportsMembers",
    path: "/members",
    component: RedirectPage,
    loader: async (): Promise<void> => {
      throw new Redirection({
        redirect: `/${this.alepha.store.get(currentProjectAtom)?.slug ?? ""}/reports/team`,
      });
    },
  });

  projectFeedbackRequest = $page({
    parent: this.core.layout,
    name: "projectFeedbackRequest",
    // Shares the root param node with `project`, so the param MUST be named
    // `projectSlug` here too — one name per tree position. Stays a top-level
    // route rather than a child of `project` so it keeps NO membership guard.
    path: "/:projectSlug/request",
    schema: {
      params: z.object({ projectSlug: z.string() }),
    },
    head: { title: "Submit feedback › Alepha Lore" },
    // Deliberately unguarded: an anonymous visitor gets the sign-in CTA rather
    // than a redirect, because this is the URL third-party "report a bug"
    // buttons link to. So it server-renders — the draft autofill it does on
    // mount is `useEffect`-only and survives hydration.
    lazy: () =>
      import("./components/project/feedback/ProjectFeedbackRequest.tsx"),
  });

  /**
   * The roadmap: a project's open releases and the epics inside them, read
   * only, for an audience the project owner chooses.
   *
   * ⚠️ **Top-level, and unguarded, and both are load-bearing.**
   *
   * `/:projectSlug` carries `use: [$secure()]`, which member-gates its whole
   * subtree AND puts it in CSR - so a child route there would render no HTML
   * a crawler could ever read, which is most of what this page is for. Two
   * routes cannot own one path either, so there is exactly ONE route here and
   * the members view (#1561) renders into it rather than beside it.
   *
   * `projectFeedbackRequest` escapes the same guard the same way, and this
   * route shares its tree position. The param MUST therefore be named
   * `projectSlug`: `RouterProvider.push` keeps one param name per position,
   * and two routes naming it differently collapse onto one, the outer wins,
   * and the inner value arrives missing.
   *
   * Being unguarded is also what makes it server-render, since Lore derives
   * the mode from the guard rather than setting it (`test/app-ssr-mode.spec.ts`
   * pins that, and pins this route as public).
   *
   * The gate is `projects.roadmapVisibility`, applied by the endpoint: `off`
   * and a project whose slug does not exist both 404 with the same message,
   * because a 403 would confirm the project exists.
   */
  projectRoadmap = $page({
    parent: this.core.layout,
    name: "projectRoadmap",
    path: "/:projectSlug/roadmap",
    schema: {
      params: z.object({ projectSlug: z.string() }),
    },
    head: (props) => {
      const roadmap = (
        props as { roadmap?: { project?: { title?: string } } } | undefined
      )?.roadmap;
      return {
        title: `${roadmap?.project?.title ?? "Roadmap"} › Roadmap`,
      };
    },
    lazy: () => import("./components/project/roadmap/ProjectRoadmap.tsx"),
    /*
     * ⚠️ Buffered, so the page can answer a real 404.
     *
     * A streamed page flushes its `<head>` before the loader runs, which
     * commits the status. This route can legitimately not exist - the slug
     * may be nobody's, or the roadmap may be off - and it is the ONE page in
     * Lore a crawler reaches, so a 200 carrying an error would be indexed as
     * a real page. `/:projectSlug/roadmap` matches any root segment, so that
     * would be an unbounded surface of soft 404s rather than one.
     *
     * The cost is the first byte waiting for the whole render, which for a
     * page this small is what the correct status is worth.
     */
    stream: false,
    onServerResponse: ({ reply }) => {
      if (this.alepha.store.get(roadmapNotFoundAtom)?.missing) {
        reply.status = 404;
      }
    },
    errorHandler: (error) => {
      // Same shape as the `project` route's: a 404 renders the real
      // not-found page rather than the layout's generic ErrorPage.
      if (isHttpError(error, 404)) {
        return createElement(NotFound, { style: { height: "100%" } });
      }
    },
    loader: async ({ params, user }) => {
      try {
        /*
         * Which endpoint answers is decided by whether there is a session,
         * and NOT by the project's visibility - which the client has no way
         * to know before asking, and must not be told.
         *
         * The member action also serves a `public` roadmap, so a signed-in
         * stranger takes that path and gets `member: false` rather than a
         * refusal. Only a visitor with no session at all reaches the
         * anonymous one, which is what keeps its guarantee - a body that
         * cannot depend on who is asking - intact.
         */
        if (user) {
          const { member, ...roadmap } = await this.roadmapApi.getMemberRoadmap(
            { params: { slug: params.projectSlug } },
          );
          return { roadmap, member };
        }

        const roadmap = await this.roadmapApi.getPublicRoadmap({
          params: { slug: params.projectSlug },
        });
        // A visitor with no session is never a member, so the page offers no
        // links into the member-gated release pages.
        return { roadmap, member: false };
      } catch (error) {
        if (isHttpError(error, 404)) {
          // The only way to tell `onServerResponse` what happened: it gets
          // the request and nothing about the loader. See
          // `roadmapNotFoundAtom`.
          this.alepha.store.set(roadmapNotFoundAtom, { missing: true });
        }
        throw error;
      }
    },
  });
}
