import {
  ROUTES_APP,
  lazyPart,
  ProjectBlockerRegistry,
  AgentPromptRegistry,
  DashboardPickerRegistry,
  ProjectShellRegistry,
  ReportsTabRegistry,
  ResourceRailRegistry,
  ResourceTabRegistry,
  hasCapability,
  canInProject,
  capabilityOption,
  currentProjectAtom,
  AssistantSuggestionRegistry,
} from "@lore/core/web";
import { $inject } from "alepha";
import { AppWindow, Bug, Layers, Package, Rocket } from "lucide-react";

import { currentErrorCountAtom } from "../atoms/currentErrorCountAtom.ts";
import { currentInstanceAtom } from "../atoms/currentInstanceAtom.ts";
import { currentInstancesAtom } from "../atoms/currentInstancesAtom.ts";
import { useDashboardApps } from "../components/project/apps/useDashboardApps.ts";
import { useReleaseArtifacts } from "../components/project/artifacts/useReleaseArtifacts.ts";
import { useQuestLiveRow } from "../components/project/quests/useQuestLiveRow.tsx";
import { errorTriagePromptDefault } from "../prompts/errorTriagePrompt.ts";

/**
 * Deploy's part of the project shell, registered on core's
 * `ProjectShellRegistry` (#E75, #Q2624): the Apps, Artifacts and Errors
 * entries, the Apps settings section, New app, the instance breadcrumb, the
 * instances in the palette, the Artifacts tab on a release, the error
 * triage prompt, the dashboard's app picker, and the Delivery tab of Reports.
 * The Quality tab is Build's since #E162.
 */
export class DeployShell {
  protected readonly shell = $inject(ProjectShellRegistry);
  protected readonly tabs = $inject(ResourceTabRegistry);
  protected readonly rails = $inject(ResourceRailRegistry);
  protected readonly prompts = $inject(AgentPromptRegistry);
  protected readonly pickers = $inject(DashboardPickerRegistry);
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
        // ⚠️ BASELINE, with no option. Instances and artifacts are
        // there whenever Apps is on; `track` adds telemetry to them. Gating
        // this entry on `track` would leave a project that deploys elsewhere
        // with no way to reach the copies it has recorded.
        //
        // A monitor's page counts as Apps: Uptime has no entry of its own
        // since monitors belong to an app (#Q3657).
        activeOn: (name) => name === "projectApps" || name === "projectMonitor",
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
        // Under the `deploy` option (#Q3631): an artifact is a build pushed
        // TO BE DEPLOYED, so a project that does not deploy has no use for
        // the page. It does not hang off `track`: artifacts arrive from CI
        // through `lore artifacts push`, not from anything an instance
        // collects. It moved under Apps on 2026-09-06 at the owner's
        // request - an artifact is a build OF AN APP.
        route: "projectArtifacts",
        permission: "artifact:read",
        labelKey: "project.menu.artifacts",
        icon: Package,
        group: "ops",
        order: 20,
        option: "deploy",
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
      key: "ship",
      order: 50,
      labelKey: "project.settings.nav.ship",
      icon: AppWindow,
      capability: "ship",
      tabs: [
        {
          // ⚠️ Under Apps since #Q2565. It used to sit outside the capability
          // pages so a project lent a host with no sigils would still see
          // it; that was the `track` option, and this section is listed
          // whenever `apps` is on, whatever `track` says. Deploying needs
          // `apps` anyway.
          route: "projectSettingsHosts",
          labelKey: "project.settings.nav.hosts",
          fullWidth: true,
        },
      ],
    });

    // The Errors inbox sits in the sidebar's Plan group, so its settings do
    // too (#Q3703): a tab of Plan's section, while Ship is on. The page and
    // the rules are Ship's, which is why Ship adds it.
    this.shell.registerSettingsTab("plan", {
      route: "projectSettingsErrors",
      labelKey: "project.settings.tab.errors",
      capability: "ship",
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

    // An artifact page ends its trail with the artifact (#Q3672): "Alepha >
    // Artifacts > shop/latest", "Artifacts" climbing back to the list
    // (`SECTION_HREF_ROUTES`). Read from the route's own params, so the
    // leaf and the document title name the tag before its read answers.
    this.shell.registerCrumb({
      order: 16,
      crumb: (ctx) => {
        const app = ctx.params.app;
        const tag = ctx.params.artifactTag;
        return ctx.routeName === "projectArtifact" && app && tag
          ? { label: `${app}/${tag}` }
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

    // Where a quest is live (#E154): a row on the quest page's rail, read
    // from the commit each copy's newest succeeded deployment ran.
    this.rails.register({
      resource: "quest",
      key: "live",
      order: 50,
      labelKey: "quest.rail.live",
      icon: Rocket,
      useValue: useQuestLiveRow,
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

    this.reports.register({
      route: "reportsDelivery",
      labelKey: "project.reports.nav.delivery",
      order: 9.8,
      needs: "ship",
      filters: ["period", "grain"],
    });
  }
}
