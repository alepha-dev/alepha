import {
  ROUTES_APP,
  lazyPart,
  AccountDeletionRegistry,
  AgentPromptRegistry,
  DashboardPickerRegistry,
  ProjectShellRegistry,
  ReportsTabRegistry,
  ResourceTabRegistry,
  hasCapability,
  canInProject,
} from "@lore/core/web";
import { $inject } from "alepha";
import { $client } from "alepha/server/links";
import { AppWindow, Bug, Package } from "lucide-react";

import type { QualityController } from "../../../api/controllers/QualityController.ts";
import { currentBlightCountAtom } from "../atoms/currentBlightCountAtom.ts";
import { currentInstanceAtom } from "../atoms/currentInstanceAtom.ts";
import { currentInstancesAtom } from "../atoms/currentInstancesAtom.ts";
import { useOwnedEstatesDeletionLine } from "../components/account/useOwnedEstatesDeletionLine.ts";
import { useDashboardApps } from "../components/project/apps/useDashboardApps.ts";
import { useReleaseArtifacts } from "../components/project/artifacts/useReleaseArtifacts.ts";
import { blightTriagePromptDefault } from "../prompts/blightTriagePrompt.ts";

/**
 * Deploy's part of the project shell, registered on core's
 * `ProjectShellRegistry` (#E75, #Q2624): the Apps, Artifacts and Blights
 * entries, the Apps settings section, New app, the instance breadcrumb, the
 * instances in the palette, the Artifacts tab on a release, the blight
 * triage prompt, the dashboard's app picker, and the Quality tab of Reports.
 */
export class DeployShell {
  protected readonly shell = $inject(ProjectShellRegistry);
  protected readonly tabs = $inject(ResourceTabRegistry);
  protected readonly prompts = $inject(AgentPromptRegistry);
  protected readonly pickers = $inject(DashboardPickerRegistry);
  protected readonly deletion = $inject(AccountDeletionRegistry);
  protected readonly reports = $inject(ReportsTabRegistry);
  protected readonly qualityApi = $client<QualityController>();

  constructor() {
    this.shell.registerNav("apps", [
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
        // Blights are reported by apps, so the entry appears once some
        // enrolled app carries the capability, and goes when the last one
        // drops it.
        //
        // ...unless blights are already filed. They outlive the app that
        // reported them (`blights.sigilId` is `ON DELETE SET NULL`) and stay
        // for the retention window, so an owner who deletes their only app
        // would otherwise lose the only way into an inbox that still holds
        // open crashes. A project that never collected one still shows no
        // entry, which is the property this predicate exists for.
        route: "projectBlights",
        permission: "blight:read",
        labelKey: "project.menu.blights",
        icon: Bug,
        group: "work",
        order: 50,
        option: "track",
        reads: [currentInstancesAtom, currentBlightCountAtom],
        available: (ctx) =>
          (ctx.get(currentInstancesAtom) ?? []).some((it) =>
            it.sigil?.kinds.includes("blights"),
          ) || (ctx.get(currentBlightCountAtom)?.count ?? 0) > 0,
        badge: (ctx) => ctx.get(currentBlightCountAtom)?.count || undefined,
      },
    ]);

    this.shell.registerSettings({
      key: "apps",
      order: 50,
      labelKey: "project.menu.apps",
      descriptionKey: "project.settings.section.apps",
      icon: AppWindow,
      capability: "apps",
      tabs: [
        {
          route: "projectSettingsApps",
          labelKey: "project.settings.tab.features",
        },
        {
          // ⚠️ Under Apps since #Q2565. It used to sit outside the capability
          // pages so a project lent an estate with no sigils would still see
          // it; that was the `track` option, and this section is listed
          // whenever `apps` is on, whatever `track` says. Deploying needs
          // `apps` anyway.
          route: "projectSettingsEstates",
          labelKey: "project.settings.nav.estates",
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
      order: 40,
      labelKey: "project.menu.create-app",
      icon: AppWindow,
      enabled: (project) =>
        hasCapability(project, "apps") && canInProject(project, "app:manage"),
      dialog: lazyPart(
        () => import("../components/project/apps/AppCreateMenuDialog.tsx"),
      ),
    });

    // The app pages contribute the instance as ONE crumb, so the header reads
    // "Project > Apps > club / b14-production": an instance is the pair
    // `(app, env)`, and one crumb says so (#Q2466).
    //
    // It replaced two crumbs, an inert app label and a linked env. There is
    // no app page: `/apps/club` redirects to a sibling instance, so a link
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
      kind: "blightTriage",
      template: blightTriagePromptDefault,
      icon: Bug,
      labelKey: "agentPrompts.triageBlights",
    });

    this.pickers.registerApps({ useApps: useDashboardApps });

    // What deleting an account takes with it from this module.
    this.deletion.register({
      key: "owned-estates",
      order: 20,
      useLine: useOwnedEstatesDeletionLine,
    });

    // Quality is INGESTED from CI, under a CI credential, and most projects
    // will never push a run: a permanently empty tab on everyone's Reports
    // page is worse than no tab. It lost its switch and joined the Apps
    // baseline, and what replaced the flag is the honest question: the tab
    // exists once there is something in it. Asked when Reports opens, not on
    // the `project` loader, which every project navigation pays.
    this.reports.register({
      route: "reportsQuality",
      labelKey: "project.reports.nav.quality",
      order: 40,
      needs: "apps",
      available: async (projectId) =>
        (await this.qualityApi.getQualityRuns({ params: { projectId } })).runs
          .length > 0,
    });
  }
}
