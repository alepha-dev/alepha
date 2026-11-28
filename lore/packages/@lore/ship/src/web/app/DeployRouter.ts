import type { ProjectHostController } from "@lore/core/api";
import { reportsUrlSchema } from "@lore/core/schemas";
import {
  $pageProject,
  $pageProjectSettings,
  currentProjectAtom,
  ProjectPageSkeleton,
  RedirectPage,
  CoreRouter,
  HostRouter,
  ReportsTabRegistry,
  ReportsUrlQuery,
  hasCapability,
} from "@lore/core/web";
import { $inject, Alepha, z } from "alepha";
import { QueryCache } from "alepha/react";
import { $page, NotFound, ReactRouter, Redirection } from "alepha/react/router";
import { isHttpError, NotFoundError } from "alepha/server";
import { $client } from "alepha/server/links";
import { createElement } from "react";

import type { AppController } from "../../api/controllers/AppController.ts";
import type { DeliveryReportsController } from "../../api/controllers/DeliveryReportsController.ts";
import type { MonitorController } from "../../api/controllers/MonitorController.ts";
import type { ProjectErrorController } from "../../api/controllers/ProjectErrorController.ts";
import { defaultAppInstance } from "../../api/schemas/defaultAppInstance.ts";
import { currentInstanceAtom } from "./atoms/currentInstanceAtom.ts";
import { currentInstancesAtom } from "./atoms/currentInstancesAtom.ts";
import { ANALYTICS_DIMENSIONS } from "./components/project/apps/analyticsDimensions.ts";
import { appInsightsFiltersSchema } from "./components/project/apps/appInsightsFiltersSchema.ts";

export { ANALYTICS_DIMENSIONS };

/**
 * Deploy's pages (#E75): apps and their tabs, artifacts, errors, the Bay console and the Apps and Hosts settings tabs.
 * Each page mounts under core with `$pageProject` or `parent:`, so no
 * router names another module's page.
 */
export class DeployRouter {
  core = $inject(CoreRouter);
  hosts = $inject(HostRouter);
  alepha = $inject(Alepha);
  deliveryApi = $client<DeliveryReportsController>();
  reportsUrl = $inject(ReportsUrlQuery);
  reportsTabs = $inject(ReportsTabRegistry);
  appApi = $client<AppController>();
  monitorApi = $client<MonitorController>();
  errorApi = $client<ProjectErrorController>();
  lendingApi = $client<ProjectHostController>();
  router = $inject(ReactRouter);
  /**
   * What runs on the machine. Labelled "Processes" (#Q3748), since "Apps"
   * read as the project's own apps; the name and the `/apps` path stay, so
   * existing links keep working.
   */
  bayApps = $page({
    // A tab of core's host console (#E166), shown while Ship is on.
    parent: this.hosts.bay,
    name: "bayApps",
    nav: { hidden: true, label: "Processes" },
    path: "/apps",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Processes`,
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
   * explicitly, because this route holds `hostId` and nothing else - and
   * naming these two differently is what breaks, silently, with the value
   * arriving missing.
   */
  bayApp = $page({
    parent: this.hosts.bay,
    name: "bayApp",
    nav: { hidden: true, label: "Instance" },
    path: "/apps/:app/:env",
    schema: { params: z.object({ app: z.string(), env: z.string() }) },
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Instance`,
    }),
    lazy: () => import("./components/bay/BayInstance.tsx"),
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
    // The Ship capability is the gate, as for Uptime and Stacks; the
    // `deploy` option only hides the sidebar entry (#Q3631), since an
    // option never guards a route (`route-capability-guards.spec.ts`).
    loader: async () => {
      if (!hasCapability(this.alepha.store.get(currentProjectAtom), "ship")) {
        throw new NotFoundError("Apps are not enabled for this project");
      }
    },
  });

  /**
   * One tag of one app, every variant on one page.
   *
   * ⚠️ `:artifactTag`, never `:tag`: one param name per tree position, the
   * trap `:epicNumber` and `:releaseTag` document. No loader, like the list:
   * the page owns its reads, and a missing tag is its own state.
   */
  projectArtifact = $pageProject({
    path: "/artifacts/:app/:artifactTag",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Artifacts`,
    }),
    lazy: () => import("./components/project/artifacts/ProjectArtifact.tsx"),
    // The Ship capability is the gate, as for Uptime and Stacks; the
    // `deploy` option only hides the sidebar entry (#Q3631), since an
    // option never guards a route (`route-capability-guards.spec.ts`).
    loader: async () => {
      if (!hasCapability(this.alepha.store.get(currentProjectAtom), "ship")) {
        throw new NotFoundError("Apps are not enabled for this project");
      }
    },
  });

  projectErrors = $pageProject({
    name: "projectErrors",
    path: "/errors",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Errors`,
    }),
    lazy: () => import("./components/project/errors/ProjectErrors.tsx"),
    loader: async () => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!project) {
        throw new NotFoundError("Project not found");
      }
      // Gated on the Ship capability, not on whether any app currently
      // carries the Errors kind. Deriving it from the instance list would
      // turn a transient `listApps` failure into a 404 on a deep link, and an
      // inbox with nothing in it costs nothing. The sidebar entry is the one
      // that derives.
      if (!hasCapability(project, "ship")) {
        throw new NotFoundError("Apps are not enabled for this project");
      }
      // No fetch here on purpose. The page hands `listProjectErrors` to an
      // `DataTable`, which owns paging/sort/filters and therefore always
      // issues its own call with its own query — so a copy fetched here was
      // read by nothing and thrown away on every visit. The badge does not
      // need it either: the parent `project` loader already seeds
      // `currentErrorCountAtom` via `countOpenProjectErrors`, and the table
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
   * One error's own page (#E185): its history, every triage verb and its
   * thread, at an address a quest, a chat message or a mention can point at.
   *
   * The same gate as the inbox: the Ship capability. The loader reads the
   * error, so an unknown id, or one of another project, is a 404 page
   * rather than an empty shell.
   */
  projectError = $pageProject({
    name: "projectError",
    path: "/errors/:errorId",
    schema: { params: z.object({ errorId: z.integer() }) },
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Error`,
    }),
    lazy: () => import("./components/project/errors/ProjectErrorPage.tsx"),
    loader: async ({ params }) => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!project) {
        throw new NotFoundError("Project not found");
      }
      if (!hasCapability(project, "ship")) {
        throw new NotFoundError("Apps are not enabled for this project");
      }
      const detail = await this.errorApi.getProjectError({
        params: { projectId: project.id, errorId: params.errorId },
      });
      // Seeds the page's own query, so it starts on the error just read
      // instead of asking for it a second time.
      this.alepha
        .inject(QueryCache)
        .set(["project-error", project.id, params.errorId], detail);
      return { detail };
    },
    errorHandler: (error) => {
      if (isHttpError(error, 404)) {
        return createElement(NotFound, { style: { height: "100%" } });
      }
    },
  });

  /**
   * The old Uptime list, gone with its sidebar entry (#Q3657): `/apps`, with
   * its Uptime column, is the overview, and a monitor lives on its app.
   */
  projectUptime = $pageProject({
    name: "projectUptime",
    path: "/uptime",
    component: RedirectPage,
    loader: async (): Promise<void> => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!project || !hasCapability(project, "ship")) {
        throw new NotFoundError("Apps are not enabled for this project");
      }
      throw new Redirection({
        redirect: this.router.path("projectApps", {
          params: { projectSlug: project.slug },
        }),
      });
    },
  });

  /**
   * A monitor's old address, kept for every link that names it (activity,
   * alerts, notifications): it opens the owning app's Uptime tab (#Q3677).
   */
  projectMonitor = $pageProject({
    name: "projectMonitor",
    path: "/uptime/:monitorId",
    schema: { params: z.object({ monitorId: z.uuid() }) },
    component: RedirectPage,
    loader: async ({ params }): Promise<void> => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!project || !hasCapability(project, "ship")) {
        throw new NotFoundError("Apps are not enabled for this project");
      }
      const [{ monitor }, { items }] = await Promise.all([
        this.monitorApi.getMonitorDetail({
          params: { monitorId: params.monitorId },
          query: { window: "24h" },
        }),
        this.appApi.listApps({ params: { projectId: project.id } }),
      ]);
      const owner = items.find((item) => item.id === monitor.appInstanceId);
      if (!owner) {
        throw new NotFoundError("This monitor belongs to no app");
      }
      throw new Redirection({
        redirect: this.router.path(
          owner.monitor?.active ? "appUptime" : "appSettings",
          {
            params: {
              projectSlug: project.slug,
              app: owner.app,
              env: owner.env,
            },
          },
        ),
      });
    },
  });

  /**
   * Stacks (#E79): apps and services deployed together from one compose.yml.
   * Under the Ship capability; the pages read with `app:read` and every write
   * is refused server-side without `deploy:manage` behind `ship.deploy`.
   */
  projectStacks = $pageProject({
    name: "projectStacks",
    path: "/stacks",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Stacks`,
    }),
    lazy: () => import("./components/project/stacks/ProjectStacks.tsx"),
    loader: async () => {
      if (!hasCapability(this.alepha.store.get(currentProjectAtom), "ship")) {
        throw new NotFoundError("Apps are not enabled for this project");
      }
    },
  });

  /**
   * The connected repository's GitHub workflows (#Q4366): start one, re-run
   * or cancel a run. The page says so when the project is not connected.
   */
  projectWorkflows = $pageProject({
    name: "projectWorkflows",
    path: "/workflows",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Workflows`,
    }),
    lazy: () => import("./components/project/workflows/ProjectWorkflows.tsx"),
    loader: async () => {
      if (!hasCapability(this.alepha.store.get(currentProjectAtom), "ship")) {
        throw new NotFoundError("Apps are not enabled for this project");
      }
    },
  });

  /**
   * One stack environment: its services, deploys, revisions, routes,
   * variables, volumes and settings. Two segments, like an app instance.
   */
  projectStackEnvironment = $pageProject({
    loading: ProjectPageSkeleton,
    name: "projectStackEnvironment",
    path: "/stacks/:stack/:env",
    schema: { params: z.object({ stack: z.string(), env: z.string() }) },
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Stacks`,
    }),
    lazy: () => import("./components/project/stacks/StackEnvironmentPage.tsx"),
    loader: async ({ params }) => {
      if (!hasCapability(this.alepha.store.get(currentProjectAtom), "ship")) {
        throw new NotFoundError("Apps are not enabled for this project");
      }
      return { stackName: params.stack, envName: params.env };
    },
  });

  projectApps = $pageProject({
    name: "projectApps",
    path: "/apps",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Apps`,
    }),
    lazy: () => import("./components/project/apps/ProjectApps.tsx"),
    loader: async () => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!hasCapability(project, "ship")) {
        throw new NotFoundError("Apps are not enabled for this project");
      }
    },
    errorHandler: (error) => {
      if (isHttpError(error, 404)) {
        return createElement(NotFound, { style: { height: "100%" } });
      }
    },
  });

  /**
   * One deployed copy — the tab shell, and the loader every tab under it reads.
   *
   * ⚠️ **Two segments, `/apps/:app/:env`, and never a joined slug.**
   * `APP_NAME_PATTERN` allows hyphens inside both halves, so
   * `/apps/acme-east-production` is genuinely ambiguous between `acme` +
   * `east-production` and `acme-east` + `production`. Both are legal rows that
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
    loading: ProjectPageSkeleton,
    name: "projectApp",
    path: "/apps/:app/:env",
    children: () => [
      this.app,
      this.appUptime,
      this.appAnalytics,
      this.appAnalyticsDimension,
      this.appVitals,
      this.appErrors,
      this.appExplore,
      this.appDeploy,
      this.appEnvironment,
      this.appBackups,
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
      if (!hasCapability(project, "ship")) {
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
      if (isHttpError(error, 404)) {
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
      if (!project || !hasCapability(project, "ship")) {
        throw new NotFoundError("Apps are not enabled for this project");
      }

      const { items } = await this.appApi.listApps({
        params: { projectId: project.id },
      });
      const target = defaultAppInstance(items, params.app);
      if (!target) {
        throw new NotFoundError("App not found");
      }

      throw new Redirection({
        redirect: this.router.path("app", {
          params: {
            projectSlug: project.slug,
            app: target.app,
            env: target.env,
          },
        }),
      });
    },
    errorHandler: (error) => {
      if (isHttpError(error, 404)) {
        return createElement(NotFound, { style: { height: "100%" } });
      }
    },
  });

  /**
   * Where the project can deploy: the hosts lent to it (epic #20). No
   * loader, and no feature flag: the page lists what it holds itself, and an
   * empty list is a normal state that says so in words. A tab of the Apps
   * section since #Q2565.
   */
  /**
   * Plan > Errors (#Q3703): the error Ignore rules. Ship's page, listed as a
   * tab of Plan's settings section by `DeployShell`.
   */
  projectSettingsErrors = $pageProjectSettings({
    name: "projectSettingsErrors",
    path: "/errors",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Errors`,
    }),
    lazy: () =>
      import("./components/project/settings/ProjectSettingsErrorsPage.tsx"),
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
      query: appInsightsFiltersSchema,
    },
    // A leaderboard's full list is a dialog over the Analytics tab now
    // (#Q3674): this URL, from a bookmark or an old link, lands on the tab
    // with that dialog open and the same window and filters.
    component: RedirectPage,
    loader: async ({ params, query }): Promise<void> => {
      this.assertBeacon();
      if (!ANALYTICS_DIMENSIONS.has(params.analyticsDimension)) {
        throw new NotFoundError("No such leaderboard");
      }
      const instance = this.alepha.store.get(currentInstanceAtom);
      const project = this.alepha.store.get(currentProjectAtom);
      if (!instance || !project) {
        throw new NotFoundError("App not found");
      }
      throw new Redirection({
        redirect: this.router.path("appAnalytics", {
          params: {
            projectSlug: project.slug,
            app: instance.app,
            env: instance.env,
          },
          query: { ...query, leaderboard: params.analyticsDimension },
        }),
      });
    },
    errorHandler: (error) => {
      if (isHttpError(error, 404)) {
        return createElement(NotFound, { style: { height: "100%" } });
      }
    },
  });

  /**
   * The copy's monitor, read and watched (#Q3677): what `/uptime/:monitorId`
   * used to be. Its switch and its settings are in the copy's Settings
   * (#Q3684), so this tab exists only while that switch is on.
   */
  appUptime = $page({
    name: "appUptime",
    path: "/uptime",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Uptime`,
    }),
    lazy: () => import("./components/project/apps/AppUptime.tsx"),
    loader: async () => {
      const instance = this.alepha.store.get(currentInstanceAtom);
      if (!instance?.monitor?.active) {
        throw new NotFoundError("Monitor is off for this app");
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
   * ⚠️ Gated on **`projectErrors`**, not on Beacon like its neighbours. The rows it
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
      this.assertProjectErrors();
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
   * What has been deployed here, and what to deploy next.
   *
   * ⚠️ Unguarded in the router. The tab self-hides on
   * `ship.deploy` plus the copy having a host, and every write behind it is
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
   * This copy's backups on its Bay machine, and every verb Bay offers on them.
   *
   * ⚠️ Unguarded in the router, like `appDeploy`: the tab self-hides on
   * `ship.deploy` plus a host, and `BackupController` refuses every read
   * and write server-side.
   */
  appBackups = $page({
    name: "appBackups",
    path: "/backups",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Backups`,
    }),
    lazy: () => import("./components/project/apps/AppBackups.tsx"),
  });

  /**
   * What this copy runs with: its environment variables.
   *
   * ⚠️ **No loader, and no value ever fetched here.** The page asks the
   * endpoint for the key names and their masks; nothing in Lore hands a stored
   * value back to a browser, the project owner included. Sealed at rest under
   * `lore:app-secrets:v1`, opened only by the deploy.
   *
   * ⚠️ Unguarded in the router, like `appDeploy` and unlike the beacon
   * tabs. The tab self-hides on `ship.deploy` plus the copy having a host,
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
   * `projectErrors` is what fills `sigil_error_groups`, and an app can carry either
   * without the other.
   */
  protected assertProjectErrors(): void {
    const instance = this.alepha.store.get(currentInstanceAtom);
    if (!instance?.sigil?.kinds.includes("errors")) {
      throw new NotFoundError("Errors are not enabled for this app");
    }
  }

  /**
   * DORA metrics, errors, errors and uptime (#Q3008). Quality is its own tab,
   * Build's `reportsQuality` (#Q3070, #E162).
   */
  reportsDelivery = $page({
    parent: this.core.projectReports,
    name: "reportsDelivery",
    prefetch: true,
    path: "/delivery",
    schema: { query: reportsUrlSchema },
    lazy: () =>
      import("./components/project/reports/ReportsDelivery.client.tsx"),
    loader: async ({ query }) => ({
      delivery: await this.deliveryApi.getReportsDelivery({
        params: {
          id: this.alepha.store.get(currentProjectAtom)?.id ?? -1,
        },
        query: this.reportsUrl.toQuery(
          query,
          this.reportsTabs.honours("reportsDelivery"),
        ),
      }),
    }),
  });
}
