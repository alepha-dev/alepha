import {
  $pageProject,
  canInProject,
  capabilityOption,
  currentProjectAtom,
} from "@lore/core/web";
import { $inject, Alepha } from "alepha";
import { $page } from "alepha/react/router";
import { NotFoundError } from "alepha/server";

/**
 * Plan's Requirements pages (#E153): one sidebar entry opening a page of
 * three tabs, each a route, in the owner's order (answer 70): Requirements
 * (`/requirements`, where the entry opens), Use cases
 * (`/requirements/use-cases`) and Personas (`/requirements/personas`).
 *
 * The persona and use case pages are full pages OUTSIDE the tabbed layout,
 * without its tab bar (decision 77), mounted as siblings of it by the quests
 * that bring them.
 */
export class RequirementsRouter {
  alepha = $inject(Alepha);

  /**
   * The tabbed layout: folder tabs and no plate (answer 73), each tab owning
   * its search, filters and buttons. It gates all three tabs at once on
   * Plan's `requirements` option: a whole surface, so its route 404s without
   * it, as Feedback's does.
   */
  projectRequirementsLayout = $pageProject({
    name: "projectRequirementsLayout",
    path: "/requirements",
    children: () => [
      this.projectRequirements,
      this.projectUseCases,
      this.projectPersonas,
    ],
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Requirements`,
    }),
    loader: async () => this.gate(),
    lazy: () => import("./components/layout/RequirementsLayout.tsx"),
  });

  projectRequirements = $page({
    name: "projectRequirements",
    // Empty, not "/": the layout's own `/requirements` is this tab's URL.
    path: "",
    loader: async () => this.gateTab("requirement:read"),
    lazy: () => import("./components/layout/RequirementsTab.tsx"),
  });

  projectUseCases = $page({
    name: "projectUseCases",
    path: "/use-cases",
    loader: async () => this.gateTab("usecase:read"),
    lazy: () => import("./components/layout/UseCasesTab.tsx"),
  });

  projectPersonas = $page({
    name: "projectPersonas",
    path: "/personas",
    loader: async () => this.gateTab("persona:read"),
    lazy: () => import("./components/layout/PersonasTab.tsx"),
  });

  /**
   * The option gate the three tabs share. 404 rather than 403, as every
   * capability guard: a page the project does not have does not exist.
   */
  protected gate(): Record<string, never> {
    const project = this.alepha.store.get(currentProjectAtom);
    if (!project) {
      throw new NotFoundError("Project not found");
    }
    if (!capabilityOption(project, "plan", "requirements")) {
      throw new NotFoundError("Requirements are not enabled for this project");
    }
    return {};
  }

  /**
   * One tab's rank gate: a tab whose permission the reader lacks is neither
   * drawn nor opened. A permission NAME read outside React, because a
   * `$page` loader cannot call a hook.
   */
  protected gateTab(permission: string): Record<string, never> {
    const project = this.alepha.store.get(currentProjectAtom);
    if (!project || !canInProject(project, permission)) {
      throw new NotFoundError("Your rank does not open this page here");
    }
    return {};
  }
}
