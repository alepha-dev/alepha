import { AccountRouter } from "@alepha/ui/account";
import {
  $pageProject,
  $pageProjectSettings,
  currentProjectAtom,
  RedirectPage,
  CoreRouter,
  hasCapability,
} from "@lore/core/web";
import { $inject, Alepha, z } from "alepha";
import { $page, NotFound, ReactRouter, Redirection } from "alepha/react/router";
import { $secure } from "alepha/security";
import { HttpError, NotFoundError } from "alepha/server";
import { $client } from "alepha/server/links";
import { createElement } from "react";

import type { AppController } from "../../api/controllers/AppController.ts";
import type { EstateController } from "../../api/controllers/EstateController.ts";
import type { QualityController } from "../../api/controllers/QualityController.ts";
import { defaultAppInstance } from "../../api/schemas/defaultAppInstance.ts";
import { currentEstateAtom } from "./atoms/currentEstateAtom.ts";
import { currentInstanceAtom } from "./atoms/currentInstanceAtom.ts";
import { currentInstancesAtom } from "./atoms/currentInstancesAtom.ts";

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

/**
 * Deploy's pages (#E75): apps and their tabs, artifacts, blights, the Bay console, Reports' Quality tab and the Apps and Estates settings tabs.
 * Each page mounts under core with `$pageProject` or `parent:`, so no
 * router names another module's page.
 */
export class DeployRouter {
  core = $inject(CoreRouter);
  alepha = $inject(Alepha);
  qualityApi = $client<QualityController>();
  appApi = $client<AppController>();
  estateApi = $client<EstateController>();
  router = $inject(ReactRouter);
  account = $inject(AccountRouter);
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
}
