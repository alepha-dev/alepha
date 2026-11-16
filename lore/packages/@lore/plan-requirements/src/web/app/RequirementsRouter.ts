import {
  $pageProject,
  canInProject,
  capabilityOption,
  currentProjectAtom,
  ProjectPageSkeleton,
} from "@lore/core/web";
import { $inject, Alepha, z } from "alepha";
import { $page, NotFound } from "alepha/react/router";
import { isHttpError, NotFoundError } from "alepha/server";
import { $client } from "alepha/server/links";
import { createElement } from "react";

import type { PersonaController } from "../../api/controllers/PersonaController.ts";
import type { UseCaseController } from "../../api/controllers/UseCaseController.ts";
import { currentPersonaAtom } from "./atoms/currentPersonaAtom.ts";
import { currentUseCaseAtom } from "./atoms/currentUseCaseAtom.ts";

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
  personaApi = $client<PersonaController>();
  useCaseApi = $client<UseCaseController>();

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
   * A persona's page: a full page OUTSIDE the tabbed layout, without its tab
   * bar (decision 77), under its tab's URL. `personaNumber`, never `number`:
   * route params are unique across the whole route table.
   */
  projectPersona = $pageProject({
    loading: ProjectPageSkeleton,
    name: "projectPersona",
    path: "/requirements/personas/:personaNumber",
    schema: { params: z.object({ personaNumber: z.integer() }) },
    head: (props, previous) => {
      const persona = (props as { persona?: { name?: string } } | undefined)
        ?.persona;
      return {
        title: `${previous?.title ?? ""} › ${persona?.name ?? "Persona"}`,
      };
    },
    lazy: () => import("./components/personas/PersonaPage.tsx"),
    loader: async ({ params }) => {
      this.gate();
      this.gateTab("persona:read");
      const project = this.alepha.store.get(currentProjectAtom)!;
      const persona = await this.personaApi.getPersonaByNumber({
        params: { projectId: project.id, number: params.personaNumber },
      });
      // The breadcrumb leaf lives in `ProjectView`, above this route.
      this.alepha.store.set(currentPersonaAtom, persona);
      return { persona };
    },
    onLeave: () => {
      this.alepha.store.set(currentPersonaAtom, undefined);
    },
    errorHandler: (error) => {
      if (isHttpError(error, 404)) {
        return createElement(NotFound, { style: { height: "100%" } });
      }
    },
  });

  /**
   * A use case's page, like a persona's: a full page outside the tabbed
   * layout. `useCaseNumber`, unique across the route table.
   */
  projectUseCase = $pageProject({
    loading: ProjectPageSkeleton,
    name: "projectUseCase",
    path: "/requirements/use-cases/:useCaseNumber",
    schema: { params: z.object({ useCaseNumber: z.integer() }) },
    head: (props, previous) => {
      const useCase = (props as { useCase?: { title?: string } } | undefined)
        ?.useCase;
      return {
        title: `${previous?.title ?? ""} › ${useCase?.title ?? "Use case"}`,
      };
    },
    lazy: () => import("./components/usecases/UseCasePage.tsx"),
    loader: async ({ params }) => {
      this.gate();
      this.gateTab("usecase:read");
      const project = this.alepha.store.get(currentProjectAtom)!;
      const useCase = await this.useCaseApi.getUseCaseByNumber({
        params: { projectId: project.id, number: params.useCaseNumber },
      });
      this.alepha.store.set(currentUseCaseAtom, useCase);
      return { useCase };
    },
    onLeave: () => {
      this.alepha.store.set(currentUseCaseAtom, undefined);
    },
    errorHandler: (error) => {
      if (isHttpError(error, 404)) {
        return createElement(NotFound, { style: { height: "100%" } });
      }
    },
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
