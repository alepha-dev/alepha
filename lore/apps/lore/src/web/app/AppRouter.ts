import { AccountRouter } from "@alepha/ui/account";
import type {
  HomeController,
  InvitationController,
  ProjectController,
  ProjectDashboardController,
} from "@lore/core/api";
import {
  $pageProject,
  $pageProjectSettings,
  currentProjectAtom,
  RedirectPage,
  CoreRouter,
  ProjectRouter,
  hasCapability,
  canInProject,
} from "@lore/core/web";
import { $inject, Alepha, z } from "alepha";
import type { RealmController } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { ReactAuth } from "alepha/react/auth";
import { $page, NotFound, ReactRouter, Redirection } from "alepha/react/router";
import { $secure } from "alepha/security";
import { HttpError, NotFoundError } from "alepha/server";
import { $client } from "alepha/server/links";
import { createElement } from "react";

import type { AppController } from "../../api/controllers/AppController.ts";
import type { AreaController } from "../../api/controllers/AreaController.ts";
import type { DirectoryController } from "../../api/controllers/DirectoryController.ts";
import type { EpicController } from "../../api/controllers/EpicController.ts";
import type { EstateController } from "../../api/controllers/EstateController.ts";
import type { FeedbackController } from "../../api/controllers/FeedbackController.ts";
import type { FolioController } from "../../api/controllers/FolioController.ts";
import type { ProjectReportsController } from "../../api/controllers/ProjectReportsController.ts";
import type { QualityController } from "../../api/controllers/QualityController.ts";
import type { QuestController } from "../../api/controllers/QuestController.ts";
import type { RoadmapController } from "../../api/controllers/RoadmapController.ts";
import type { SigilController } from "../../api/controllers/SigilController.ts";
import { defaultAppInstance } from "../../api/schemas/defaultAppInstance.ts";
import { currentEpicAtom } from "./atoms/currentEpicAtom.ts";
import { currentEstateAtom } from "./atoms/currentEstateAtom.ts";
import { currentFolioAttachmentsAtom } from "./atoms/currentFolioAttachmentsAtom.ts";
import { currentInstanceAtom } from "./atoms/currentInstanceAtom.ts";
import { currentInstancesAtom } from "./atoms/currentInstancesAtom.ts";
import { currentQuestAtom } from "./atoms/currentQuestAtom.ts";
import { folioTreeSeedAtom } from "./atoms/folioTreeSeedAtom.ts";
import { projectDirectoriesAtom } from "./atoms/projectDirectoriesAtom.ts";
import { roadmapNotFoundAtom } from "./atoms/roadmapNotFoundAtom.ts";
import { userFoliosAtom } from "./atoms/userFoliosAtom.ts";
import { FEEDBACK_PAGE_SIZE } from "./components/project/feedback/feedbackPageSize.ts";

/**
 * The leaderboards that have a detail page, which is exactly the set
 * `InsightsController.getInsightsDimension` accepts.
 *
 * Duplicated deliberately rather than imported from the controller: this file
 * ships to the browser, and importing a controller module would pull the
 * repositories and the database provider into the client bundle. `entryPath`
 * is in the list and is not a dataset dimension - it groups by `path` and
 * differs only in the measure, which is the distinction that makes a landing
 * page report possible at all.
 */
export const ANALYTICS_DIMENSIONS = new Set([
  "country",
  "path",
  "entryPath",
  "campaign",
  "device",
  "referrer",
  "browser",
  "os",
  "auth",
]);

export class AppRouter {
  core = $inject(CoreRouter);
  alepha = $inject(Alepha);
  questApi = $client<QuestController>();
  projectApi = $client<ProjectController>();
  projectReportsApi = $client<ProjectReportsController>();
  qualityApi = $client<QualityController>();
  invitationApi = $client<InvitationController>();
  feedbackApi = $client<FeedbackController>();
  epicApi = $client<EpicController>();
  projectDashboardApi = $client<ProjectDashboardController>();
  areaApi = $client<AreaController>();
  // The framework's inbox, not a Lore controller: the read side of the
  // notification channel lives in `alepha/api/notifications`.
  roadmapApi = $client<RoadmapController>();
  sigilApi = $client<SigilController>();
  appApi = $client<AppController>();
  estateApi = $client<EstateController>();
  folioApi = $client<FolioController>();
  directoryApi = $client<DirectoryController>();
  router = $inject(ReactRouter);
  auth = $inject(ReactAuth);
  account = $inject(AccountRouter);
  projectRouter = $inject(ProjectRouter);
  realmApi = $client<RealmController>();
  homeApi = $client<HomeController>();
  dateTime = $inject(DateTimeProvider);

  /**
   * How long a folio-tree seed stays usable. Matches the `staleTime` on
   * `useFolioTreeModel`'s fallback query so both halves of the tree's
   * freshness policy say the same thing.
   */
  protected static readonly FOLIO_TREE_TTL_MS = 30_000;

  /**
   * Fill `userFoliosAtom` + `projectDirectoriesAtom` — the two lists the
   * folio tree pane renders from — unless they already hold this
   * project's rows and were filled recently. See `folioTreeSeedAtom` for
   * why the unconditional fetch these loaders used to do was two wasted
   * HTTP calls per folio opened.
   *
   * Deliberately does no `await` before deciding: callers put it in a
   * `Promise.all` next to their own fetch, and anything awaited ahead of
   * the decision would push these calls into a later tick and out of the
   * `BatchCollector` window they need to share.
   */
  protected async seedFolioTree(projectId: number): Promise<void> {
    const seed = this.alepha.store.get(folioTreeSeedAtom);
    const now = this.dateTime.nowMillis();
    if (
      seed &&
      seed.projectId === projectId &&
      now - seed.at < AppRouter.FOLIO_TREE_TTL_MS
    ) {
      return;
    }
    const [folios, directories] = await Promise.all([
      this.folioApi.tree({ params: { projectId } }),
      this.directoryApi.listAllDirectories({ params: { projectId } }),
    ]);
    this.alepha.store.set(userFoliosAtom, folios);
    this.alepha.store.set(projectDirectoriesAtom, directories);
    this.alepha.store.set(folioTreeSeedAtom, { projectId, at: now });
  }

  /**
   * The console for one `bay` estate: what is running on the machine, what it
   * costs, and the buttons that act on it.
   *
   * ⚠️ **Inside the account shell, at `/account/estates/:estateId`** (#E68).
   * An estate belongs to a user, not a project, so its console is a detail
   * page under the account's Estates entry, the way `/admin/users/:id` sits
   * under Users. Every route here carries `nav: { hidden: true }`: none is a
   * sidebar entry, and `isActivePath`'s prefix match keeps "Estates" lit on
   * all of them. The route NAMES kept, only the paths moved, and `/bay/:id`
   * was removed with no redirect (pre-v1).
   *
   * `/account/estates` is under the account's root, so it never meets the
   * machine-facing `/estates` pull routes at the application root.
   *
   * The param is the uuid, not the slug: a slug is unique per OWNER, and the
   * URL has to name one estate among everyone's.
   */
  bay = $page({
    parent: this.account.layout,
    nav: { hidden: true, label: "Estate" },
    children: () => [
      this.bayOverview,
      this.bayApps,
      this.bayApp,
      this.bayCommands,
      this.baySettings,
    ],
    name: "bay",
    path: "/estates/:estateId",
    // Owner-only, and the 404 comes from the server: `getEstate` goes through
    // `EstateService.loadOwned`, which answers 404 for anyone else, so a
    // non-owner gets a real not-found for the whole subtree rather than an
    // empty console.
    use: [$secure()],
    schema: { params: z.object({ estateId: z.string() }) },
    head: (props) => {
      const estate = (props as { estate?: { slug?: string } } | undefined)
        ?.estate;
      return { title: this.account.accountTitle(estate?.slug ?? "Estate") };
    },
    lazy: () => import("./components/bay/BayLayout.tsx"),
    loader: async ({ params }) => {
      const estate = await this.estateApi.getEstate({
        params: { estateId: params.estateId },
      });
      this.alepha.store.set(currentEstateAtom, estate);
      return { estate };
    },
    onLeave: () => {
      this.alepha.store.set(currentEstateAtom, undefined);
    },
    errorHandler: (error) => {
      if (HttpError.is(error, 404)) {
        return createElement(NotFound, { style: { height: "100%" } });
      }
    },
  });

  bayOverview = $page({
    name: "bayOverview",
    nav: { hidden: true, label: "Overview" },
    path: "/",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Overview`,
    }),
    lazy: () => import("./components/bay/BayOverview.tsx"),
  });

  bayApps = $page({
    name: "bayApps",
    nav: { hidden: true, label: "Apps" },
    path: "/apps",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Apps`,
    }),
    lazy: () => import("./components/bay/BayApps.tsx"),
  });

  /**
   * One instance on the machine.
   *
   * ⚠️ `:app` and `:env` repeat the names `projectApp` uses, deliberately.
   * `ReactRouter.path` merges the CURRENT route's params with the caller's by
   * NAME, so two trees that mean the same thing by `app` and `env` may share
   * them. A link from here to a project's app page has to pass `projectSlug`
   * explicitly, because this route holds `estateId` and nothing else - and
   * naming these two differently is what breaks, silently, with the value
   * arriving missing.
   */
  bayApp = $page({
    name: "bayApp",
    nav: { hidden: true, label: "Instance" },
    path: "/apps/:app/:env",
    schema: { params: z.object({ app: z.string(), env: z.string() }) },
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Instance`,
    }),
    lazy: () => import("./components/bay/BayInstance.tsx"),
  });

  bayCommands = $page({
    name: "bayCommands",
    nav: { hidden: true, label: "Commands" },
    path: "/commands",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Commands`,
    }),
    lazy: () => import("./components/bay/BayCommands.tsx"),
  });

  baySettings = $page({
    name: "baySettings",
    nav: { hidden: true, label: "Settings" },
    path: "/settings",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Settings`,
    }),
    lazy: () => import("./components/bay/BaySettings.tsx"),
  });

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
    lazy: () => import("./components/project/ProjectQuestsPage.tsx"),
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
    animation: ({ meta }) => {
      if (meta.transition) {
        return meta.transition;
      }

      if (meta.completed) {
        return {
          exit: {
            name: "zoomOutUp",
            duration: 800,
          },
        };
      }

      if (meta.deleted) {
        return {
          exit: {
            name: "zoomOut",
            duration: 400,
          },
        };
      }
    },
    lazy: () => import("./components/project/quest/QuestView.tsx"),
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
      if (HttpError.is(error, 404)) {
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
        throw new Redirection(`/${project.slug}/epics/${epic.number}?tab=flow`);
      }

      // The focus quest is in the component by construction - it is the
      // quest the walk started from - so the head needs no second fetch.
      const quest = quests.find((q) => q.shortId === params.shortId);
      return { quest, quests };
    },
    errorHandler: (error) => {
      if (HttpError.is(error, 404)) {
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
      if (HttpError.is(error, 404)) {
        return createElement(NotFound, { style: { height: "100%" } });
      }
    },
  });

  /**
   * Every build this project has, across every app (feedback #2111).
   *
   * No loader: `listArtifacts` is one indexed read and it is paid for by the
   * page that shows it, the same arrangement `AppArtifactsList` documents.
   * Putting it in the project loader would charge every reader for a page
   * most of them are not opening.
   */
  projectArtifacts = $pageProject({
    path: "/artifacts",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Artifacts`,
    }),
    lazy: () => import("./components/project/artifacts/ProjectArtifacts.tsx"),
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

  // Quest #66 originally split this from the entity-level "folios" naming
  // by giving it its own URL path (/archive), when the directory tree +
  // blobs were a distinct "Archive" module. The 2026-08 great rename
  // (Task 5) folded that module back into Folios — entities, MCP tools,
  // and now the URL path are all "folio(s)"-named again. Internal route
  // name stays `projectFolios`, unchanged since before quest #66.
  projectFolios = $pageProject({
    name: "projectFolios",
    children: () => [this.projectFoliosNew, this.projectFoliosFolio],
    path: "/folios",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Folios`,
    }),
    lazy: () => import("./components/folios/FoliosLayout.tsx"),
    loader: async () => {
      const project = this.alepha.store.get(currentProjectAtom);
      const projectId = project?.id;
      if (projectId === undefined) {
        throw new NotFoundError("Project not found");
      }
      if (!hasCapability(project, "knowledge")) {
        throw new NotFoundError("Knowledge is not enabled for this project");
      }
      // ⚠️ A permission NAME, and a module-level function rather than
      // `useRank()`: a `$page` loader runs outside React and cannot call a
      // hook, and the loader and the component must not disagree about which
      // pages exist. Same arrangement as `hasCapability` beside it.
      //
      // 404 rather than 403, matching the capability guard above it: a page
      // the reader may not open is a page that does not exist for them, and a
      // 403 would confirm what is behind it.
      if (!canInProject(project, "folio:read")) {
        throw new NotFoundError("Your rank does not open folios here");
      }
      // The tree's own two lists, which `seedFolioTree` owns — the folio
      // list AND the directory list, the latter load-bearing: the tree's
      // fallback
      // `useQuery` is gated on `enabled: !seeded`, where "seeded" is
      // satisfied by `userFoliosAtom` ALONE. Any project with at least one
      // folio therefore looked seeded the moment the folio list resolved,
      // the fallback never ran, and a hard load of `/folios` rendered a
      // tree with no directories in it — every nested folio flat at the
      // root.
      //
      // The directory-contents fetch and the `?dir=` resolution that used
      // to sit here went with `FolioBrowser` — they existed to fill its
      // table and its breadcrumb. A folio page sets its own breadcrumb
      // from the folio's `metadata.path`, so nothing downstream reads
      // them any more.
      await this.seedFolioTree(projectId);
    },
    onLeave: () => {
      this.alepha.store.set(currentFolioAttachmentsAtom, []);
    },
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

  projectBlights = $pageProject({
    name: "projectBlights",
    path: "/blights",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Blights`,
    }),
    lazy: () => import("./components/project/blights/ProjectBlights.tsx"),
    loader: async () => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!project) {
        throw new NotFoundError("Project not found");
      }
      // Gated on the Apps capability, not on whether any app currently
      // carries the Blights kind. Deriving it from the instance list would
      // turn a transient `listApps` failure into a 404 on a deep link, and an
      // inbox with nothing in it costs nothing. The sidebar entry is the one
      // that derives.
      if (!hasCapability(project, "apps")) {
        throw new NotFoundError("Apps are not enabled for this project");
      }
      // No fetch here on purpose. The page hands `listBlights` to an
      // `DataTable`, which owns paging/sort/filters and therefore always
      // issues its own call with its own query — so a copy fetched here was
      // read by nothing and thrown away on every visit. The badge does not
      // need it either: the parent `project` loader already seeds
      // `currentBlightCountAtom` via `countOpenBlights`, and the table
      // refreshes it a moment later.
      //
      // Nor can the two be merged: `$action` coalesces CONCURRENT calls into
      // `/api/_batch`, and these were sequential by construction — the loader
      // has to resolve before the page renders and the table mounts.
      //
      // The rule: a route loader fetches only what the page cannot fetch for
      // itself.
    },
  });

  /**
   * Every deployed copy of every app, in one flat table.
   *
   * Gated on the Apps capability the same way `projectApp` is, and for the
   * same reason: the capability is the whole gate, so reaching this by URL
   * without it is a 404 rather than a 403.
   */
  projectApps = $pageProject({
    name: "projectApps",
    path: "/apps",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Apps`,
    }),
    lazy: () => import("./components/project/apps/ProjectApps.tsx"),
    loader: async () => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!hasCapability(project, "apps")) {
        throw new NotFoundError("Apps are not enabled for this project");
      }
    },
    errorHandler: (error) => {
      if (HttpError.is(error, 404)) {
        return createElement(NotFound, { style: { height: "100%" } });
      }
    },
  });

  /**
   * One deployed copy — the tab shell, and the loader every tab under it reads.
   *
   * ⚠️ **Two segments, `/apps/:app/:env`, and never a joined slug.**
   * `APP_NAME_PATTERN` allows hyphens inside both halves, so
   * `/apps/club-b14-production` is genuinely ambiguous between `club` +
   * `b14-production` and `club-b14` + `production`. Both are legal rows that
   * can coexist in one project, since the unique key is the pair, and both
   * produce that identical slug: a lookup returns two rows and picks one
   * arbitrarily. The collision is silent, so it can never be the URL.
   *
   * ⚠️ The segments are `:app` and `:env`, never `:id` or `:name`.
   * `/:projectSlug` is already a param node at an outer position, and the
   * router keeps one key per position: two routes naming different segments
   * the same thing collapse onto one, the outer one wins, and the inner param
   * arrives missing.
   */
  projectApp = $pageProject({
    name: "projectApp",
    path: "/apps/:app/:env",
    children: () => [
      this.app,
      this.appAnalytics,
      this.appAnalyticsDimension,
      this.appVitals,
      this.appErrors,
      this.appExplore,
      this.appArtifacts,
      this.appDeploy,
      this.appEnvironment,
      this.appSettings,
    ],
    schema: {
      params: z.object({
        app: z.string(),
        env: z.string(),
      }),
    },
    head: (props, previous) => {
      const instance = (
        props as { instance?: { app?: string; env?: string } } | undefined
      )?.instance;
      const name = instance ? `${instance.app}/${instance.env}` : "App";
      return { title: `${previous?.title ?? ""} › ${name}` };
    },
    lazy: () => import("./components/project/apps/AppLayout.tsx"),
    loader: async ({ params }) => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!project) {
        throw new NotFoundError("Project not found");
      }
      // The capability is the whole gate — the nav entry is hidden on the same
      // answer, so reaching this by URL with it off is a page that does not
      // exist, hence a 404 and not a 403. The API side answers 400 instead,
      // because a write into a disabled capability is a request the project
      // understands and declines.
      if (!hasCapability(project, "apps")) {
        throw new NotFoundError("Apps are not enabled for this project");
      }

      // Two calls, and the list is not a lookup helper: `getApp` is the
      // membership proof and the 404, and the list re-seeds the atom the
      // sidebar and Spotlight read, which matters when this page is deep-linked
      // into (the project loader's own fetch may have failed, or another tab
      // may have created an instance since). They are concurrent, so the client
      // folds them into one `/api/_batch`.
      const [instance, listed] = await Promise.all([
        this.appApi.getApp({
          params: { projectId: project.id, app: params.app, env: params.env },
        }),
        this.appApi
          .listApps({ params: { projectId: project.id } })
          .then((r) => r.items)
          .catch(() => undefined),
      ]);
      if (listed) {
        this.alepha.store.set(currentInstancesAtom, listed);
      }
      this.alepha.store.set(currentInstanceAtom, instance);

      // Nothing analytics-shaped is fetched here. This loader runs for every
      // tab, Settings included, and it used to await a full `getInsights` —
      // ten aggregate queries against Analytics Engine — before any of them
      // rendered. The two tabs that show insights ask for them themselves
      // (`useAppInsights`), which is what makes the others free to open.
      return { instance };
    },
    onLeave: () => {
      this.alepha.store.set(currentInstanceAtom, undefined);
    },
    errorHandler: (error) => {
      if (HttpError.is(error, 404)) {
        return createElement(NotFound, { style: { height: "100%" } });
      }
    },
  });

  /**
   * `/apps/:app` with no environment: a redirect to that app's default
   * instance, so every link written before Apps v3 keeps working.
   *
   * The rule is `defaultAppInstance`, the same function `AppService` calls:
   * **`production` if that env exists, else the first env by name.** It lives
   * in its own module rather than on the service because this loader runs in
   * the browser and cannot inject one, and a second copy of the rule is how two
   * callers end up disagreeing about which page a link opens. An app with no
   * instance at all is a 404, which is what a bare name that never existed
   * should be.
   *
   * ⚠️ A SIBLING of `projectApp`, not a parent. `/apps/:app/:env` is the page;
   * making this its parent would render a redirect shell above every tab.
   * The router tries the longer static-shaped match first, so a two-segment
   * URL never reaches this.
   *
   * `/apps/docs-production` becomes `/apps/docs-production/production` after
   * the backfill: one hop, invisible.
   */
  projectAppRedirect = $pageProject({
    name: "projectAppRedirect",
    path: "/apps/:app",
    schema: {
      params: z.object({
        app: z.string(),
      }),
    },
    // A component rather than `lazy`: it is a few lines, and core's web
    // barrel is not something to load through a dynamic import.
    component: RedirectPage,
    // Annotated `Promise<void>` because every path throws, so the inferred
    // return type would be `never` and the children union would refuse it.
    loader: async ({ params }): Promise<void> => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!project || !hasCapability(project, "apps")) {
        throw new NotFoundError("Apps are not enabled for this project");
      }

      const { items } = await this.appApi.listApps({
        params: { projectId: project.id },
      });
      const target = defaultAppInstance(items, params.app);
      if (!target) {
        throw new NotFoundError("App not found");
      }

      throw new Redirection(
        this.router.path("app", {
          params: {
            projectSlug: project.slug,
            app: target.app,
            env: target.env,
          },
        }),
      );
    },
    errorHandler: (error) => {
      if (HttpError.is(error, 404)) {
        return createElement(NotFound, { style: { height: "100%" } });
      }
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
      if (HttpError.is(error, 404)) {
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

  projectSettingsKnowledge = $pageProjectSettings({
    name: "projectSettingsKnowledge",
    path: "/knowledge",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Folios`,
    }),
    lazy: () =>
      import("./components/project/settings/ProjectSettingsKnowledgePage.tsx"),
  });

  projectSettingsApps = $pageProjectSettings({
    name: "projectSettingsApps",
    path: "/apps",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Apps`,
    }),
    lazy: () =>
      import("./components/project/settings/ProjectSettingsAppsPage.tsx"),
  });

  /**
   * Where the project can deploy: the estates lent to it (epic #20). No
   * loader, and no feature flag: the page lists what it holds itself, and an
   * empty list is a normal state that says so in words. A tab of the Apps
   * section since #Q2565.
   */
  projectSettingsEstates = $pageProjectSettings({
    name: "projectSettingsEstates",
    path: "/estates",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Estates`,
    }),
    lazy: () =>
      import("./components/project/settings/ProjectSettingsEstatesPage.tsx"),
  });

  app = $page({
    name: "app",
    path: "/",
    lazy: () => import("./components/project/apps/AppDashboard.tsx"),
  });

  appAnalytics = $page({
    name: "appAnalytics",
    path: "/analytics",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Analytics`,
    }),
    lazy: () => import("./components/project/apps/AppAnalytics.client.tsx"),
    loader: async () => {
      this.assertBeacon();
    },
  });

  /**
   * One leaderboard in full: where a card's "More" link goes.
   *
   * A SIBLING of `appAnalytics` rather than a child of it. A child would mean
   * `AppAnalytics` rendering a `NestedView`, which would draw the whole
   * overview above the detail; the detail replaces the overview, and the tab
   * bar above both comes from `projectApp` either way.
   *
   * ⚠️ The segment is `:analyticsDimension`, not `:dimension` or `:name`, and
   * that is load-bearing for the same reason `:app` and `:env` are. The router keeps
   * one key per position, so two routes naming different segments the same
   * thing collapse onto one and the inner param arrives missing. A name nobody
   * else will reach for is the whole protection.
   *
   * The segment is user input on its way to a query, so it is checked here
   * against the set of leaderboards that exist and 404s otherwise. Letting the
   * endpoint's own enum reject it would work too, and would answer 400 from a
   * fetch instead of rendering the app's own not-found page.
   */
  appAnalyticsDimension = $page({
    name: "appAnalyticsDimension",
    path: "/analytics/:analyticsDimension",
    schema: {
      params: z.object({
        analyticsDimension: z.string(),
      }),
    },
    head: (props, previous) => {
      const dimension = (props as { dimension?: string } | undefined)
        ?.dimension;
      return { title: `${previous?.title ?? ""} › ${dimension ?? "Detail"}` };
    },
    lazy: () => import("./components/project/apps/AppAnalyticsDimension.tsx"),
    loader: async ({ params }) => {
      this.assertBeacon();
      if (!ANALYTICS_DIMENSIONS.has(params.analyticsDimension)) {
        throw new NotFoundError("No such leaderboard");
      }
      return { dimension: params.analyticsDimension };
    },
    errorHandler: (error) => {
      if (HttpError.is(error, 404)) {
        return createElement(NotFound, { style: { height: "100%" } });
      }
    },
  });

  appVitals = $page({
    name: "appVitals",
    path: "/vitals",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Vitals`,
    }),
    lazy: () => import("./components/project/apps/AppVitals.tsx"),
    loader: async () => {
      this.assertBeacon();
    },
  });

  /**
   * Distinct failures still happening in this app.
   *
   * ⚠️ Gated on **`blights`**, not on Beacon like its neighbours. The rows it
   * renders come from `sigil_error_groups`, which `SigilIngestService` writes
   * under the `errors` gate - an app that collects page views and refuses
   * error reports has nothing to put here, and one that does the reverse has
   * everything. Copying `assertBeacon()` from the tab above would have got
   * both of those backwards.
   *
   * It reads the same insights payload Analytics does, so it costs the same
   * one query and shares `?range=` with the other two curated tabs.
   */
  appErrors = $page({
    name: "appErrors",
    path: "/errors",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Errors`,
    }),
    lazy: () => import("./components/project/apps/AppErrors.client.tsx"),
    loader: async () => {
      this.assertBlights();
    },
  });

  /**
   * The query explorer: the framework's analytics query builder, scoped to
   * this app.
   *
   * Gated on Beacon like the two tabs above it, and for the same reason — it
   * reads the same two datasets. Deliberately carries NO `?range=` / filter
   * query params: `useAppInsights`'s selection is a curated page's controls,
   * and this panel owns its own window, grouping and filters. Threading the
   * two together would mean one of them silently losing.
   */
  appExplore = $page({
    name: "appExplore",
    path: "/explore",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Explore`,
    }),
    lazy: () => import("./components/project/apps/AppExplore.tsx"),
    loader: async () => {
      this.assertBeacon();
    },
  });

  /**
   * What CI has built for this app, one row per tag.
   *
   * Its own tab rather than a card at the bottom of the Dashboard (feedback
   * #2065): a build list is a table, and a table wants a tab's width. NOT
   * gated on beacon, unlike Analytics, Vitals and Explore: artifacts come
   * from CI through `lore artifacts push`, not from the sigil's
   * telemetry, so an app that sends no beacon still has a build history.
   */
  appArtifacts = $page({
    name: "appArtifacts",
    path: "/artifacts",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Artifacts`,
    }),
    lazy: () => import("./components/project/apps/AppArtifacts.tsx"),
  });

  /**
   * What has been deployed here, and what to deploy next.
   *
   * ⚠️ Unguarded in the router, like `appArtifacts`. The tab self-hides on
   * `apps.deploy` plus the copy having an estate, and every write behind it is
   * refused server-side by #1205's gate; a route guard would only turn a link
   * somebody already holds into a 404 while changing no permission.
   */
  appDeploy = $page({
    name: "appDeploy",
    path: "/deploy",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Deploy`,
    }),
    lazy: () => import("./components/project/apps/AppDeploy.tsx"),
  });

  /**
   * What this copy runs with: its environment variables.
   *
   * ⚠️ **No loader, and no value ever fetched here.** The page asks the
   * endpoint for the key names and their masks; nothing in Lore hands a stored
   * value back to a browser, the project owner included. Sealed at rest under
   * `lore:app-secrets:v1`, opened only by the deploy.
   *
   * ⚠️ Unguarded in the router, like `appArtifacts` and unlike the beacon
   * tabs. The tab self-hides on `apps.deploy` plus the copy having an estate,
   * and the endpoints refuse server-side; a route guard here would only turn a
   * link somebody already holds into a 404 while changing no permission.
   */
  appEnvironment = $page({
    name: "appEnvironment",
    path: "/environment",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Environment`,
    }),
    lazy: () => import("./components/project/apps/AppEnvironment.tsx"),
  });

  appSettings = $page({
    name: "appSettings",
    path: "/settings",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Settings`,
    }),
    lazy: () => import("./components/project/apps/AppSettings.tsx"),
  });

  /**
   * The gate the two analytics tabs share.
   *
   * Reads the open instance rather than the project: Beacon is a per-instance
   * capability now, and an instance with no sigil at all carries none of them.
   * A 404 rather than a 403, for the same reason the deleted project-level
   * Insights route was — the tab is hidden on this exact condition, so reaching
   * it by URL with Beacon off is asking for a page that does not exist here,
   * not one that is withheld.
   */
  protected assertBeacon(): void {
    const instance = this.alepha.store.get(currentInstanceAtom);
    if (!instance?.sigil?.kinds.includes("beacon")) {
      throw new NotFoundError("Beacon is not enabled for this app");
    }
  }

  /**
   * The Errors tab's gate. Separate from `assertBeacon` because the two answer
   * different questions: `beacon` is what fills `sigil_views` / `sigil_vitals`,
   * `blights` is what fills `sigil_error_groups`, and an app can carry either
   * without the other.
   */
  protected assertBlights(): void {
    const instance = this.alepha.store.get(currentInstanceAtom);
    if (!instance?.sigil?.kinds.includes("blights")) {
      throw new NotFoundError("Blights are not enabled for this app");
    }
  }

  /**
   * One card, open over the board.
   *
   * A child route rather than local state: clicking a card used to be
   * `setSelectedQuest(quest)`, which had no URL and — the part that
   * actually bit — **no refetch**, so a long-lived board edited whatever
   * `getBoard` returned however long ago. A loader gets fresh data on open
   * for free, and the card becomes linkable.
   *
   * ⚠️ The param is `shortId`, the SAME name `projectQuest` uses at the
   * same position. That is deliberate: the router keeps one param name per
   * path position, so two routes naming it DIFFERENTLY are what silently
   * lose the inner value (the trap `projectEpic`'s `epicNumber` documents).
   * Sharing the name is the safe side of that rule, as `projectSlug` does
   * across the whole tree.
   */
  projectKanbanCard = $page({
    name: "projectKanbanCard",
    path: "/:shortId",
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
    lazy: () => import("./components/project/ProjectKanbanCard.tsx"),
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
      // The board watches this atom to patch its own row, which is how an
      // edit in the sheet moves the card behind it without a refetch.
      this.alepha.store.set(currentQuestAtom, quest);
      return { quest };
    },
    onLeave: () => {
      this.alepha.store.set(currentQuestAtom, undefined);
    },
    errorHandler: (error) => {
      if (HttpError.is(error, 404)) {
        return createElement(NotFound, { style: { height: "100%" } });
      }
    },
  });

  reportsOverview = $page({
    parent: this.core.projectReports,
    name: "reportsOverview",
    path: "/",
    lazy: () =>
      import("./components/project/reports/ReportsOverview.client.tsx"),
    loader: async () => ({
      overview: await this.projectReportsApi.getReportsOverview({
        params: {
          id: this.alepha.store.get(currentProjectAtom)?.id ?? -1,
        },
      }),
    }),
  });

  reportsQuests = $page({
    parent: this.core.projectReports,
    name: "reportsQuests",
    path: "/quests",
    lazy: () => import("./components/project/reports/ReportsQuests.client.tsx"),
    loader: async () => ({
      quests: await this.projectReportsApi.getReportsQuests({
        params: {
          id: this.alepha.store.get(currentProjectAtom)?.id ?? -1,
        },
      }),
    }),
  });

  reportsMembers = $page({
    parent: this.core.projectReports,
    name: "reportsMembers",
    path: "/members",
    lazy: () =>
      import("./components/project/reports/ReportsMembers.client.tsx"),
    loader: async () => ({
      members: await this.projectReportsApi.getReportsMembers({
        params: {
          id: this.alepha.store.get(currentProjectAtom)?.id ?? -1,
        },
      }),
    }),
  });

  /**
   * The one Reports tab whose data is INGESTED rather than derived.
   *
   * Deliberately not 404'd when the project has no Apps and no run, matching
   * how the `projectKanban` route stays reachable while only its sidebar entry
   * is gated: a link someone already holds should not break because a switch
   * moved. What decides whether the tab is OFFERED is `reportsTabs`, which
   * asks for Apps and for a run to exist - Quality lost its own flag when it
   * joined the Apps baseline, since a tab that appears once there is something
   * in it needs no switch.
   */
  reportsQuality = $page({
    parent: this.core.projectReports,
    name: "reportsQuality",
    path: "/quality",
    lazy: () =>
      import("./components/project/reports/ReportsQuality.client.tsx"),
    loader: async () => ({
      quality: await this.qualityApi.getQualityRuns({
        params: {
          projectId: this.alepha.store.get(currentProjectAtom)?.id ?? -1,
        },
      }),
    }),
  });

  projectFoliosNew = $page({
    name: "projectFoliosNew",
    path: "/new",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › New`,
    }),
    lazy: () => import("./components/folios/FolioCreatePage.tsx"),
    loader: async ({ url }) => {
      // A draft has no attachments of its own: without this the last opened
      // folio's attachments were offered in the new folio's link picker.
      this.alepha.store.set(currentFolioAttachmentsAtom, []);
      // Carry the source directory across the navigation: the folio tree's
      // create link adds `?dir=<shortId>` when the user is in a directory; resolve to a UUID here so the editor can pass
      // it to `folioApi.create({ directoryId })`. Without this, every
      // folio created from this page lands at the project root
      // regardless of the directory the user clicked from.
      const dirParam = url.searchParams.get("dir");
      const project = this.alepha.store.get(currentProjectAtom);
      let directoryId: string | undefined;
      if (dirParam && project) {
        const shortId = Number.parseInt(dirParam, 10);
        if (Number.isFinite(shortId)) {
          try {
            const dir = await this.directoryApi.getDirectoryByShortId({
              params: { projectId: project.id, shortId },
            });
            directoryId = dir.id;
          } catch {
            // Stale `?dir` — fall back to root.
            directoryId = undefined;
          }
        }
      }
      // Populate the tree's lists so the document workspace's meta bar
      // (Task 8) can resolve the create-mode `directoryId` above to a
      // display name — the chip shows where the new folio WILL land, even
      // though it's not clickable yet (there's no row for `folio.move` to
      // act on until the folio is saved). Landing directly on
      // `/folios/new` (rather than navigating here from `/folios`)
      // previously left `projectDirectoriesAtom` unset or stale from a
      // prior folio view. Going through `seedFolioTree` also fills
      // `userFoliosAtom`, which this loader never did and which the tree
      // pane's `enabled: !seeded` fallback then had to fetch on mount.
      if (project) {
        await this.seedFolioTree(project.id);
      }
      return { directoryId };
    },
  });

  projectFoliosFolio = $page({
    name: "projectFoliosFolio",
    path: "/:shortId",
    schema: {
      params: z.object({ shortId: z.integer() }),
    },
    head: (props, previous) => {
      const folio = (
        props as
          | {
              folio?: {
                title?: string;
                metadata?: { path?: { name: string }[] };
              };
            }
          | undefined
      )?.folio;
      const path = folio?.metadata?.path ?? [];
      const dirPrefix =
        path.length > 0 ? `${path.map((p) => p.name).join("/")}/` : "";
      return {
        title: `${previous?.title ?? ""} › ${dirPrefix}${folio?.title ?? "Folio"}`,
      };
    },
    lazy: () => import("./components/folios/editor/FolioWorkspace.tsx"),
    loader: async ({ params }) => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!project) {
        throw new NotFoundError("Project not found");
      }
      // ONE call opens a folio. Everything the workspace needs that keys
      // off the folio itself — its links, its directory chain, its
      // attachments, its revision count — is asked for on the folio
      // request, because each of those used to be a follow-up round-trip
      // that could only START once this one had resolved (they address
      // the folio by `id`, and the URL only carries `shortId`). Sitting
      // after the `await`, they were far past the 10ms `BatchCollector`
      // window and could never join it. See Lore #109.
      //
      // `seedFolioTree` rides alongside and is usually a no-op: the
      // `/folios` layout loader that necessarily ran before this one
      // already filled the tree's lists, and a layout loader is not
      // re-run on child navigation. When it does have to fetch, it does
      // so in this same tick and batches with the folio.
      const [folio] = await Promise.all([
        this.folioApi.getByShortId({
          params: { projectId: project.id, shortId: params.shortId },
          query: {
            withLinks: true,
            withPath: true,
            withAttachments: true,
          },
        }),
        this.seedFolioTree(project.id),
      ]);
      this.alepha.store.set(
        currentFolioAttachmentsAtom,
        folio.metadata?.attachments ?? [],
      );
      // ⚠️ No breadcrumb write. The header used to read "Lore › Folios ›
      // <dirs…> › <folio title>", built from `folio.metadata.path` through
      // `currentFolioPathAtom`; it reads "Lore › Folios › #F12" now
      // (feedback #P2137), which `ProjectView` takes from the route params.
      // The atom had no other consumer and is gone.
      return { folio };
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
      if (HttpError.is(error, 404)) {
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
        if (HttpError.is(error, 404)) {
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
