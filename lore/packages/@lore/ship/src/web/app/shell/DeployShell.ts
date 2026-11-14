import {
  ROUTES_APP,
  ROUTES_HOST,
  lazyPart,
  AccountDeletionRegistry,
  ProjectBlockerRegistry,
  AgentPromptRegistry,
  DashboardPickerRegistry,
  ProjectShellRegistry,
  ReportsTabRegistry,
  ResourceTabRegistry,
  hasCapability,
  canInProject,
  capabilityOption,
  currentProjectAtom,
  AssistantSuggestionRegistry,
} from "@lore/core/web";
import { $inject } from "alepha";
import { Activity, AppWindow, Bug, Layers, Package } from "lucide-react";

import { currentErrorCountAtom } from "../atoms/currentErrorCountAtom.ts";
import { currentHostAtom } from "../atoms/currentHostAtom.ts";
import { currentInstanceAtom } from "../atoms/currentInstanceAtom.ts";
import { currentInstancesAtom } from "../atoms/currentInstancesAtom.ts";
import { useOwnedHostsDeletionLine } from "../components/account/useOwnedHostsDeletionLine.ts";
import { useDashboardApps } from "../components/project/apps/useDashboardApps.ts";
import { useReleaseArtifacts } from "../components/project/artifacts/useReleaseArtifacts.ts";
import { useHomeHostsBlocker } from "../components/project/settings/useHomeHostsBlocker.ts";
import { errorTriagePromptDefault } from "../prompts/errorTriagePrompt.ts";

/**
 * Deploy's part of the project shell, registered on core's
 * `ProjectShellRegistry` (#E75, #Q2624): the Apps, Artifacts and Errors
 * entries, the Apps settings section, New app, the instance breadcrumb, the
 * instances in the palette, the Artifacts tab on a release, the error
 * triage prompt, the dashboard's app picker, and the Quality tab of Reports.
 */
export class DeployShell {
  protected readonly shell = $inject(ProjectShellRegistry);
  protected readonly tabs = $inject(ResourceTabRegistry);
  protected readonly prompts = $inject(AgentPromptRegistry);
  protected readonly pickers = $inject(DashboardPickerRegistry);
  protected readonly deletion = $inject(AccountDeletionRegistry);
  protected readonly blockers = $inject(ProjectBlockerRegistry);
  protected readonly reports = $inject(ReportsTabRegistry);
  protected readonly suggestions = $inject(AssistantSuggestionRegistry);

  constructor() {
    // The assistant's prompts on the Apps list and on an app's every tab,
    // whose layout is `projectApp` (#Q3585).
    this.suggestions.register({
      routes: (name) => name === "projectApps" || name === "projectApp",
      keys: [
        "assistant.suggest.apps.deploys",
        "assistant.suggest.apps.errors",
        "assistant.suggest.apps.silent",
      ],
    });
    this.shell.registerNav("ship", [
      {
        route: "projectUptime",
        permission: "app:read",
        labelKey: "uptime.title",
        icon: Activity,
        group: "ops",
        order: 30,
        option: "uptime",
        activeOn: (name) =>
          name === "projectUptime" || name === "projectMonitor",
      },
      {
        // ONE entry, pointing at the list. It was a disclosure group with one
        // child per enrolled app; once an instance is something you create
        // freely, that is a list growing without bound in the one piece of
        // chrome that must not.
        route: "projectApps",
        permission: "app:read",
        labelKey: "project.menu.apps",
        icon: AppWindow,
        group: "ops",
        order: 10,
        // ⚠️ BASELINE, with no option. Instances, artifacts and quality are
        // there whenever Apps is on; `track` adds telemetry to them. Gating
        // this entry on `track` would leave a project that deploys elsewhere
        // with no way to reach the copies it has recorded.
      },
      {
        // Stacks (#E79), behind their own `stacks` option, off by default.
        // An option that owns a nav entry is switched in General >
        // Capabilities, like `uptime`.
        route: "projectStacks",
        permission: "app:read",
        labelKey: "stacks.title",
        icon: Layers,
        group: "ops",
        order: 15,
        option: "stacks",
        activeOn: (name) =>
          name === "projectStacks" || name === "projectStackEnvironment",
      },
      {
        // ⚠️ Baseline, with no option: artifacts arrive from CI through
        // `lore artifacts push`, not from anything an instance collects, so
        // a project that watches nothing still has a build history and still
        // needs the door to it. It moved under Apps on 2026-09-06 at the
        // owner's request - an artifact is a build OF AN APP.
        route: "projectArtifacts",
        permission: "artifact:read",
        labelKey: "project.menu.artifacts",
        icon: Package,
        group: "ops",
        order: 20,
      },
      {
        // Offer an inbox for an app collecting crashes, or for retained
        // open errors. Uptime outages have no sigil, and removing an app
        // must not hide the inbox while its failures still need triage.
        route: "projectErrors",
        permission: "error:read",
        labelKey: "project.menu.errors",
        icon: Bug,
        group: "work",
        order: 50,
        // Existing inbox items stay reachable with tracking off, including
        // outages from monitors that never had a sigil.
        reads: [
          currentProjectAtom,
          currentInstancesAtom,
          currentErrorCountAtom,
        ],
        available: (ctx) =>
          (ctx.get(currentErrorCountAtom)?.count ?? 0) > 0 ||
          (capabilityOption(ctx.get(currentProjectAtom), "ship", "track") &&
            (ctx.get(currentInstancesAtom) ?? []).some((it) =>
              it.sigil?.kinds.includes("errors"),
            )),
        badge: (ctx) => ctx.get(currentErrorCountAtom)?.count || undefined,
      },
    ]);

    this.shell.registerSettings({
      key: "apps",
      order: 50,
      labelKey: "project.settings.nav.ship",
      icon: AppWindow,
      capability: "ship",
      tabs: [
        {
          route: "projectSettingsApps",
          labelKey: "project.settings.tab.features",
        },
        {
          // ⚠️ Under Apps since #Q2565. It used to sit outside the capability
          // pages so a project lent a host with no sigils would still see
          // it; that was the `track` option, and this section is listed
          // whenever `apps` is on, whatever `track` says. Deploying needs
          // `apps` anyway.
          route: "projectSettingsHosts",
          labelKey: "project.settings.nav.hosts",
        },
      ],
    });

    // After New Release, matching the sidebar's Work then Ops order: an app
    // is where the work is deployed, not part of planning it.
    //
    // ⚠️ Gated on the rank as well as on the capability. Creating an instance
    // is owner-only server-side, so a member shown this item would open a
    // dialog that can only answer 403.
    this.shell.registerCreate({
      key: "app",
      navRoute: "projectApps",
      order: 40,
      labelKey: "project.menu.create-app",
      icon: AppWindow,
      enabled: (project) =>
        hasCapability(project, "ship") && canInProject(project, "app:manage"),
      dialog: lazyPart(
        () => import("../components/project/apps/AppCreateMenuDialog.tsx"),
      ),
    });

    // The app pages contribute the instance as ONE crumb, so the header reads
    // "Project > Apps > acme / east-production": an instance is the pair
    // `(app, env)`, and one crumb says so (#Q2466).
    //
    // It replaced two crumbs, an inert app label and a linked env. There is
    // no app page: `/apps/acme` redirects to a sibling instance, so a link
    // there moved the reader sideways.
    this.shell.registerCrumb({
      order: 10,
      reads: [currentInstanceAtom],
      crumb: (ctx) => {
        const instance = ctx.get(currentInstanceAtom);
        return ROUTES_APP.has(ctx.routeName) && instance
          ? {
              label: `${instance.app} / ${instance.env}`,
              href: ctx.path("app", {
                projectSlug: ctx.projectSlug,
                app: instance.app,
                env: instance.env,
              }),
            }
          : undefined;
      },
    });

    // A host's console ends its trail with the host (#Q3408): "Project >
    // Hosts > ovh", "Hosts" climbing back to the project's hosts list.
    // The console's tabs stay on its plate, not on this bar. It replaced an
    // "All hosts" link in the plate, which said what the crumb already did.
    this.shell.registerCrumb({
      order: 15,
      reads: [currentHostAtom],
      crumb: (ctx) => {
        const host = ctx.get(currentHostAtom);
        return ROUTES_HOST.includes(ctx.routeName) && host
          ? {
              label: host.slug,
              href: ctx.path("bayOverview", {
                projectSlug: ctx.projectSlug,
                hostSlug: host.slug,
              }),
            }
          : undefined;
      },
    });

    // ⚠️ Instances are palette rows from the atom, not from the sidebar. They
    // used to BE sidebar children; #1771 collapsed that group to one entry,
    // and dropping the children would have dropped every app out of the
    // palette, leaving the list page as the only door to one. A row is an
    // INSTANCE, so both halves render: three copies of one app would
    // otherwise be three identical rows.
    this.shell.registerPalette({
      reads: [currentInstancesAtom],
      entries: (ctx) =>
        (ctx.get(currentInstancesAtom) ?? []).map((instance) => ({
          label: `${instance.app} / ${instance.env}`,
          href: ctx.path("app", {
            projectSlug: ctx.projectSlug,
            app: instance.app,
            env: instance.env,
          }),
          kind: "app",
        })),
    });

    // A release lists the artifacts built from its tag: a tab on its page,
    // and a count on its plate, its KPIs and its retag warning.
    this.tabs.register({
      resource: "release",
      key: "artifacts",
      order: 50,
      labelKey: "release.tab.artifacts",
      icon: Package,
      useCollection: useReleaseArtifacts,
      component: lazyPart(
        () =>
          import("../components/project/artifacts/ReleaseArtifactsPanel.tsx"),
      ),
      metaKeys: {
        one: "release.meta.artifacts.one",
        many: "release.meta.artifacts.many",
      },
      kpiKeys: {
        label: "release.kpi.artifacts.label",
        some: "release.kpi.artifacts.built",
        none: "release.artifacts.emptyShort",
      },
      retagKeys: {
        one: "release.edit.tagWarning.artifacts.one",
        many: "release.edit.tagWarning.artifacts.many",
      },
    });

    // `Bug`, not `ListChecks`: both are triage loops, and the surface is
    // what tells them apart in a menu.
    this.prompts.register({
      kind: "errorTriage",
      template: errorTriagePromptDefault,
      icon: Bug,
      labelKey: "agentPrompts.triageErrors",
    });

    this.pickers.registerApps({ useApps: useDashboardApps });

    // What deleting an account takes with it from this module.
    this.deletion.register({
      key: "owned-hosts",
      order: 20,
      useLine: useOwnedHostsDeletionLine,
    });

    // A project that is the home of a host is not deleted and keeps Apps
    // (#Q3280); the page says so before the click (#Q3281).
    this.blockers.register({
      key: "home-hosts",
      order: 20,
      useLine: useHomeHostsBlocker,
    });

    this.reports.register({
      route: "reportsDelivery",
      labelKey: "project.reports.nav.delivery",
      order: 9.8,
      needs: "ship",
      filters: ["period", "grain"],
    });
    // Quality is its own tab again (#Q3070), right after Delivery. It shows
    // for every Apps project, with the push command until CI sends a run.
    this.reports.register({
      route: "reportsQuality",
      labelKey: "project.reports.nav.quality",
      order: 9.85,
      needs: "ship",
      filters: ["period", "branch"],
    });
  }
}
