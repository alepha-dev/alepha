import {
  $pageProject,
  canInProject,
  capabilityOption,
  currentProjectAtom,
  ProjectPageSkeleton,
} from "@lore/core/web";
import { $inject, Alepha, z } from "alepha";
import { NotFound } from "alepha/react/router";
import { isHttpError, NotFoundError } from "alepha/server";
import { $client } from "alepha/server/links";
import { createElement } from "react";

import type { PersonaController } from "../../api/controllers/PersonaController.ts";
import type { UseCaseController } from "../../api/controllers/UseCaseController.ts";
import { currentPersonaAtom } from "./atoms/currentPersonaAtom.ts";
import { currentUseCaseAtom } from "./atoms/currentUseCaseAtom.ts";

/**
 * Plan's Requirements pages (#E153): three list pages, each with its own
 * sidebar entry, listed there Personas (`/requirements/personas`), Use
 * cases (`/requirements/use-cases`), then Requirements (`/requirements`):
 * who, what they do, what it must satisfy. Then a persona's and a use
 * case's page.
 *
 * No route sets a `head`: the document title is the breadcrumb's own trail
 * (`ProjectTrail`), so the two cannot drift.
 */
export class RequirementsRouter {
  alepha = $inject(Alepha);
  personaApi = $client<PersonaController>();
  useCaseApi = $client<UseCaseController>();

  /**
   * The requirements list, where the sidebar's first entry opens. It gates
   * on Plan's `requirements` option: a whole surface, so its route 404s
   * without it, as Feedback's does.
   */
  projectRequirements = $pageProject({
    loading: ProjectPageSkeleton,
    name: "projectRequirements",
    path: "/requirements",
    // The requirement whose detail pane is open: what `[[#S15]]` links to.
    schema: { query: z.object({ requirement: z.text().optional() }) },
    loader: async () => this.gatePage("requirement:read"),
    lazy: () => import("./components/pages/RequirementsPage.tsx"),
  });

  projectUseCases = $pageProject({
    loading: ProjectPageSkeleton,
    name: "projectUseCases",
    path: "/requirements/use-cases",
    loader: async () => this.gatePage("usecase:read"),
    lazy: () => import("./components/pages/UseCasesPage.tsx"),
  });

  projectPersonas = $pageProject({
    loading: ProjectPageSkeleton,
    name: "projectPersonas",
    path: "/requirements/personas",
    loader: async () => this.gatePage("persona:read"),
    lazy: () => import("./components/pages/PersonasPage.tsx"),
  });

  /**
   * A persona's page: a full page under its list's URL. `personaNumber`, never `number`:
   * route params are unique across the whole route table.
   */
  /**
   * The test book (#Q3774): the requirements per chapter with their
   * criteria and last results, styled for print.
   */
  projectRequirementsTestBook = $pageProject({
    loading: ProjectPageSkeleton,
    name: "projectRequirementsTestBook",
    path: "/requirements/test-book",
    lazy: () => import("./components/traceability/TestBookPage.tsx"),
    loader: async () => {
      this.gate();
      this.gateRank("requirement:read");
      return {};
    },
  });

  projectPersona = $pageProject({
    loading: ProjectPageSkeleton,
    name: "projectPersona",
    path: "/requirements/personas/:personaNumber",
    schema: { params: z.object({ personaNumber: z.integer() }) },
    lazy: () => import("./components/personas/PersonaPage.tsx"),
    loader: async ({ params }) => {
      this.gate();
      this.gateRank("persona:read");
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
   * A use case's page, like a persona's: a full page under its list's URL. `useCaseNumber`, unique across the route table.
   */
  projectUseCase = $pageProject({
    loading: ProjectPageSkeleton,
    name: "projectUseCase",
    path: "/requirements/use-cases/:useCaseNumber",
    schema: { params: z.object({ useCaseNumber: z.integer() }) },
    lazy: () => import("./components/usecases/UseCasePage.tsx"),
    loader: async ({ params }) => {
      this.gate();
      this.gateRank("usecase:read");
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
   * A list page's gates: the option, then the reader's rank.
   */
  protected gatePage(permission: string): Record<string, never> {
    this.gate();
    return this.gateRank(permission);
  }

  /**
   * The option gate every Requirements page shares. 404 rather than 403, as every
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
   * One page's rank gate: a page whose permission the reader lacks is neither
   * listed in the sidebar nor opened. A permission NAME read outside React, because a
   * `$page` loader cannot call a hook.
   */
  protected gateRank(permission: string): Record<string, never> {
    const project = this.alepha.store.get(currentProjectAtom);
    if (!project || !canInProject(project, permission)) {
      throw new NotFoundError("Your rank does not open this page here");
    }
    return {};
  }
}
