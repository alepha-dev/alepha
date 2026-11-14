import { $inject, Alepha } from "alepha";
import { I18nProvider } from "alepha/react/i18n";
import { ReactRouter } from "alepha/react/router";

import { currentProjectAtom } from "../atoms/currentProjectAtom.ts";
import { pageCrumbAtom } from "../atoms/pageCrumbAtom.ts";
import {
  SECTION_HREF_ROUTES,
  SECTION_LABEL_KEYS,
} from "../components/project/projectViewRoutes.ts";
import { ProjectShellRegistry } from "../registries/ProjectShellRegistry.ts";

/**
 * One step of a project page's trail: what the breadcrumb shows, and where it
 * leads when it is not the page already open.
 */
export interface ProjectTrailCrumb {
  label: string;
  href?: string;
}

/**
 * A project page's trail (#Q3408): the project, its section, a settings
 * page's section, then the leaves the modules contribute (a host, `#12`,
 * a release tag, an area's name).
 *
 * The ONE place it is computed. `ProjectView` draws it as the breadcrumb, and
 * `ProjectRouter`'s `$head({ afterPages })` joins the same labels into the
 * document title, so the two cannot drift: the host console used to read
 * "MCS > Hosts > ovh" in the header and "MCS › ovh › Overview" in the tab.
 *
 * Reads the store directly, through the atoms the contributions name, so it
 * answers the same from a component and from the head, which runs outside
 * React once every loader has set its atom.
 */
export class ProjectTrail {
  protected readonly alepha = $inject(Alepha);
  protected readonly shell = $inject(ProjectShellRegistry);
  protected readonly i18n = $inject(I18nProvider);
  // Untyped on purpose: the trail names routes a module registers at
  // runtime, which core's registered routers cannot name.
  protected readonly router = $inject(ReactRouter<any>);

  /**
   * The trail of the page `routeName` with `params`, or `[]` outside a
   * project.
   */
  public crumbs(
    routeName: string,
    params: Record<string, string | undefined>,
  ): ProjectTrailCrumb[] {
    const project = this.alepha.store.get(currentProjectAtom);
    if (!project) return [];
    const projectSlug = project.slug;
    const tr = (key: string) => this.i18n.tr(key as any);

    const crumbs: ProjectTrailCrumb[] = [
      {
        label: project.title,
        href: this.router.path("project", { params: { projectSlug } }),
      },
    ];
    // Kanban is a view of `projectQuests`, not its own section: the trail
    // reads "Quests" whichever view is active, as the sidebar's one entry.
    const sectionKey = SECTION_LABEL_KEYS[routeName];
    if (sectionKey) {
      const sectionRoute = SECTION_HREF_ROUTES[routeName];
      crumbs.push({
        label: tr(sectionKey),
        href: sectionRoute
          ? this.router.path(sectionRoute, { params: { projectSlug } })
          : undefined,
      });
    }
    // A settings page adds its section, "Project › Settings › Plan", since
    // the sidebar group is the only other thing naming it (#Q2565).
    const activeSettings = this.shell.findSettingsTab(routeName);
    // Automations pages already carry their own "Automations" crumb.
    if (
      activeSettings &&
      crumbs.at(-1)?.label !== tr(activeSettings.section.labelKey)
    ) {
      crumbs.push({ label: tr(activeSettings.section.labelKey) });
    }
    // A detail page's own leaf, each contributed by the module that owns
    // the page.
    for (const contribution of this.shell.crumbContributions()) {
      const crumb = contribution.crumb({
        routeName,
        params,
        get: (atom) => this.alepha.store.get(atom),
        projectSlug,
        path: (route, routeParams) =>
          this.router.path(route, {
            params: { projectSlug, ...routeParams },
          }),
      });
      if (crumb) crumbs.push(crumb);
    }
    // The leaf a page named for itself once its own read answered
    // (`usePageCrumb`), for the open page only.
    const leaf = this.alepha.store.get(pageCrumbAtom);
    if (leaf && leaf.routeName === routeName) {
      crumbs.push({ label: leaf.label });
    }
    return crumbs;
  }

  /**
   * The document title of that page: the trail's labels, in order, as the
   * breadcrumb reads them.
   */
  public title(
    routeName: string,
    params: Record<string, string | undefined>,
  ): string | undefined {
    const crumbs = this.crumbs(routeName, params);
    return crumbs.length > 0
      ? crumbs.map((crumb) => crumb.label).join(" › ")
      : undefined;
  }
}
