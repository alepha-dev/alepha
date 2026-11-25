import {
  AssistantSuggestionRegistry,
  canInProject,
  capabilityOption,
  ElementReferenceRegistry,
  formatReference,
  lazyPart,
  ProjectShellRegistry,
} from "@lore/core/web";
import { $inject } from "alepha";
import { BookText, ListChecks, UsersRound } from "lucide-react";

import { currentPersonaAtom } from "../atoms/currentPersonaAtom.ts";
import { currentUseCaseAtom } from "../atoms/currentUseCaseAtom.ts";
import { REQUIREMENTS_NAV_ROUTES } from "../components/pages/requirementsNavRoutes.ts";
import { usePersonaReferences } from "../components/personas/usePersonaReferences.ts";
import { useRequirementReferences } from "../components/requirements/useRequirementReferences.ts";
import { useUseCaseReferences } from "../components/usecases/useUseCaseReferences.ts";

/**
 * Requirements' part of the project shell (#E153), registered on core's
 * `ProjectShellRegistry` under PLAN, whose entries `WorkShell` owns: hence
 * `extendNav` (decision 66), never `registerNav`.
 *
 * Three entries in their own band, one per list page; no existing entry
 * moves.
 */
export class RequirementsShell {
  protected readonly shell = $inject(ProjectShellRegistry);
  protected readonly references = $inject(ElementReferenceRegistry);
  protected readonly suggestions = $inject(AssistantSuggestionRegistry);

  /**
   * The id an href of this project carries, or `undefined`.
   */
  protected static matchPage(
    path: string,
    projectSlug: string,
    pattern: RegExp,
  ): string | undefined {
    const match = pattern.exec(path);
    return match && match[1] === projectSlug ? match[2] : undefined;
  }

  constructor() {
    // The assistant's prompts on Requirements' pages (#Q3972): a use case's
    // page is the one the dock reads, through its page context.
    this.suggestions.register({
      routes: (name) => name === "projectUseCase",
      keys: [
        "assistant.suggest.usecase.review",
        "assistant.suggest.usecase.steps",
        "assistant.suggest.usecase.quests",
      ],
    });
    this.suggestions.register({
      routes: (name) =>
        name === "projectUseCases" ||
        name === "projectRequirements" ||
        name === "projectPersonas" ||
        name === "projectPersona",
      keys: [
        "assistant.suggest.requirements.failing",
        "assistant.suggest.requirements.uncovered",
        "assistant.suggest.requirements.stale",
      ],
    });
    // A band of its own, between Errors and Folios (#Q3830), holding one
    // entry per list page: Personas, Use cases, then Requirements. Each is lit on its list and on the pages a row
    // of it opens. No count (#Q4241): a total says nothing there. Hovered,
    // a "+" opens the same sheet as the header's create menu.
    const isOn =
      (routes: readonly string[]) =>
      (name: string): boolean =>
        routes.includes(name);
    this.shell.extendNav("plan", [
      {
        route: "projectRequirements",
        permission: "requirement:read",
        labelKey: "project.menu.requirements",
        icon: ListChecks,
        group: "requirements",
        order: 30,
        option: "requirements",
        activeOn: isOn(REQUIREMENTS_NAV_ROUTES.requirements),
      },
      {
        route: "projectUseCases",
        permission: "usecase:read",
        labelKey: "project.menu.useCases",
        icon: BookText,
        group: "requirements",
        order: 20,
        option: "requirements",
        activeOn: isOn(REQUIREMENTS_NAV_ROUTES.useCases),
      },
      {
        route: "projectPersonas",
        permission: "persona:read",
        labelKey: "project.menu.personas",
        icon: UsersRound,
        group: "requirements",
        order: 10,
        option: "requirements",
        activeOn: isOn(REQUIREMENTS_NAV_ROUTES.personas),
      },
    ]);

    // New persona, from the header's "+" menu, after Feedback.
    this.shell.registerCreate({
      key: "persona",
      navRoute: "projectPersonas",
      order: 70,
      labelKey: "project.menu.create-persona",
      icon: UsersRound,
      enabled: (project) =>
        capabilityOption(project, "plan", "requirements") &&
        canInProject(project, "persona:write"),
      dialog: lazyPart(
        () => import("../components/personas/PersonaCreateMenuSheet.tsx"),
      ),
    });

    // New requirement, then New use case and New persona.
    this.shell.registerCreate({
      key: "requirement",
      navRoute: "projectRequirements",
      order: 69,
      labelKey: "project.menu.create-requirement",
      icon: ListChecks,
      enabled: (project) =>
        capabilityOption(project, "plan", "requirements") &&
        canInProject(project, "requirement:write"),
      dialog: lazyPart(
        () =>
          import("../components/requirements/RequirementCreateMenuSheet.tsx"),
      ),
    });
    // New use case, beside New persona.
    this.shell.registerCreate({
      key: "usecase",
      navRoute: "projectUseCases",
      order: 71,
      labelKey: "project.menu.create-usecase",
      icon: BookText,
      enabled: (project) =>
        capabilityOption(project, "plan", "requirements") &&
        canInProject(project, "usecase:write"),
      dialog: lazyPart(
        () => import("../components/usecases/UseCaseCreateMenuSheet.tsx"),
      ),
    });
    // A use case's page reads "Acme > Use cases > #U7": the reference as
    // an inert leaf, as an epic's reads "Acme > Epics > #E2". The number, not
    // the title, which heads the page's own aside; and the section crumb
    // climbs back to the list (`SECTION_HREF_ROUTES`).
    this.shell.registerCrumb({
      order: 53,
      reads: [currentUseCaseAtom],
      crumb: (ctx) => {
        const useCase = ctx.get(currentUseCaseAtom);
        return ctx.routeName === "projectUseCase" && useCase
          ? { label: formatReference("usecase", useCase.number) }
          : undefined;
      },
    });

    // A persona's page reads "Acme > Personas > #A2".
    this.shell.registerCrumb({
      order: 51,
      reads: [currentPersonaAtom],
      crumb: (ctx) => {
        const persona = ctx.get(currentPersonaAtom);
        return ctx.routeName === "projectPersona" && persona
          ? { label: formatReference("persona", persona.number) }
          : undefined;
      },
    });
    // The test book names itself: "Acme > Requirements > Test book".
    this.shell.registerCrumb({
      order: 55,
      crumb: (ctx) =>
        ctx.routeName === "projectRequirementsTestBook"
          ? { labelKey: "requirements.trace.export.testBook" }
          : undefined,
    });

    // `[[#A2]]`: a persona, after the kinds a body names more often.
    this.references.register({
      kind: "persona",
      order: 60,
      brokenKey: "folios.wikilink.broken.personaNotFound",
      href: (projectSlug, ref) =>
        `/${projectSlug}/requirements/personas/${ref.number}`,
      match: (path, projectSlug) =>
        RequirementsShell.matchPage(
          path,
          projectSlug,
          /^\/([^/]+)\/requirements\/personas\/(\d+)(?:[#?]|$)/,
        ),
      preview: lazyPart(
        () => import("../components/personas/PersonaReferencePreview.tsx"),
      ),
      useReferences: usePersonaReferences,
    });
    // `[[#U7]]`: a use case.
    this.references.register({
      kind: "usecase",
      order: 61,
      brokenKey: "folios.wikilink.broken.useCaseNotFound",
      href: (projectSlug, ref) =>
        `/${projectSlug}/requirements/use-cases/${ref.number}`,
      match: (path, projectSlug) =>
        RequirementsShell.matchPage(
          path,
          projectSlug,
          /^\/([^/]+)\/requirements\/use-cases\/(\d+)(?:[#?]|$)/,
        ),
      preview: lazyPart(
        () => import("../components/usecases/UseCaseReferencePreview.tsx"),
      ),
      useReferences: useUseCaseReferences,
    });
    // `[[#S15]]`: a requirement, which opens the Requirements page on it.
    this.references.register({
      kind: "requirement",
      order: 62,
      brokenKey: "folios.wikilink.broken.requirementNotFound",
      href: (projectSlug, ref) =>
        `/${projectSlug}/requirements?requirement=${ref.number}`,
      match: (path, projectSlug) =>
        RequirementsShell.matchPage(
          path,
          projectSlug,
          /^\/([^/]+)\/requirements\?requirement=(\d+)(?:[#&]|$)/,
        ),
      preview: lazyPart(
        () =>
          import("../components/requirements/RequirementReferencePreview.tsx"),
      ),
      useReferences: useRequirementReferences,
    });
  }
}
