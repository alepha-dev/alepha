import {
  AgentPromptRegistry,
  canInProject,
  capabilityOption,
  ElementReferenceRegistry,
  formatReference,
  lazyPart,
  ProjectShellRegistry,
} from "@lore/core/web";
import { $inject } from "alepha";
import {
  BookText,
  ClipboardCheck,
  ClipboardList,
  Compass,
  FileCode,
  FileInput,
  ListChecks,
  PenLine,
  Presentation,
  UsersRound,
} from "lucide-react";

import { RequirementsPromptDefaults } from "../../../api/schemas/RequirementsPromptDefaults.ts";
import { currentPersonaAtom } from "../atoms/currentPersonaAtom.ts";
import { currentRequirementAtom } from "../atoms/currentRequirementAtom.ts";
import { currentUseCaseAtom } from "../atoms/currentUseCaseAtom.ts";
import { REQUIREMENTS_ROUTES } from "../components/layout/requirementsTabs.ts";
import { usePersonaReferences } from "../components/personas/usePersonaReferences.ts";
import { useRequirementReferences } from "../components/requirements/useRequirementReferences.ts";
import { useUseCaseReferences } from "../components/usecases/useUseCaseReferences.ts";

/**
 * Requirements' part of the project shell (#E153), registered on core's
 * `ProjectShellRegistry` under PLAN, whose entries `WorkShell` owns: hence
 * `extendNav` (decision 66), never `registerNav`.
 *
 * ⚠️ One entry and nothing else in the sidebar (owner, answers 53 and 64):
 * no band is added, titled or reordered, and no existing entry moves.
 */
export class RequirementsShell {
  protected readonly shell = $inject(ProjectShellRegistry);
  protected readonly references = $inject(ElementReferenceRegistry);
  protected readonly prompts = $inject(AgentPromptRegistry);

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
    this.shell.extendNav("plan", [
      {
        // A band of its own, between Errors and Folios (#Q3830, revising
        // F1515's "the sidebar is not reworked" for this entry only).
        route: "projectRequirements",
        permission: "requirement:read",
        labelKey: "project.menu.requirements",
        icon: ClipboardList,
        group: "requirements",
        order: 10,
        option: "requirements",
        // Lit on every tab and on every persona, use case and requirement
        // page. No badge.
        activeOn: (name) => REQUIREMENTS_ROUTES.includes(name),
      },
    ]);

    // New persona, from the header's "+" menu, after Feedback.
    this.shell.registerCreate({
      key: "persona",
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

    // The Verify prompt kinds, editable in Settings › Agent prompts with
    // only `requirements` on (#E153, answer 74). Rendered on the server.
    for (const [kind, icon, labelKey] of [
      ["useCaseTest", ClipboardCheck, "requirements.prompt.useCaseTest"],
      ["useCaseSpec", FileCode, "requirements.prompt.useCaseSpec"],
      ["personaExplore", Compass, "requirements.prompt.personaExplore"],
      ["useCaseDemo", Presentation, "requirements.prompt.useCaseDemo"],
      ["requirementImport", FileInput, "requirements.prompt.requirementImport"],
      ["useCaseDraft", PenLine, "requirements.prompt.useCaseDraft"],
    ] as const) {
      this.prompts.register({
        kind,
        template: RequirementsPromptDefaults[kind],
        icon,
        labelKey,
        option: "requirements",
      });
    }

    // New requirement, then New use case and New persona.
    this.shell.registerCreate({
      key: "requirement",
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
    // A use case's page reads "Acme > Requirements > #U7": the reference as
    // an inert leaf, as an epic's reads "Acme > Epics > #E2". The number, not
    // the title, which heads the page's own aside; and no crumb for the tab,
    // which no other section has: "Requirements" climbs back to the tab that
    // lists the page (`SECTION_HREF_ROUTES`).
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

    // A persona's page reads "Acme > Requirements > #A2".
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
    // A requirement's page reads "Acme > Requirements > #S15".
    this.shell.registerCrumb({
      order: 54,
      reads: [currentRequirementAtom],
      crumb: (ctx) => {
        const requirement = ctx.get(currentRequirementAtom);
        return ctx.routeName === "projectRequirement" && requirement
          ? { label: formatReference("requirement", requirement.number) }
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
    // `[[#S15]]`: a requirement.
    this.references.register({
      kind: "requirement",
      order: 62,
      brokenKey: "folios.wikilink.broken.requirementNotFound",
      href: (projectSlug, ref) =>
        `/${projectSlug}/requirements/requirement/${ref.number}`,
      match: (path, projectSlug) =>
        RequirementsShell.matchPage(
          path,
          projectSlug,
          /^\/([^/]+)\/requirements\/requirement\/(\d+)(?:[#?]|$)/,
        ),
      preview: lazyPart(
        () =>
          import("../components/requirements/RequirementReferencePreview.tsx"),
      ),
      useReferences: useRequirementReferences,
    });
  }
}
