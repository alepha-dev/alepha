import {
  canInProject,
  capabilityOption,
  ElementReferenceRegistry,
  formatReference,
  lazyPart,
  ProjectShellRegistry,
} from "@lore/core/web";
import { $inject } from "alepha";
import { ClipboardList, UsersRound } from "lucide-react";

import { currentPersonaAtom } from "../atoms/currentPersonaAtom.ts";
import { REQUIREMENTS_ROUTES } from "../components/layout/requirementsTabs.ts";
import { usePersonaReferences } from "../components/personas/usePersonaReferences.ts";

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
        // Right after Epics (30), before Feedback (40).
        route: "projectRequirements",
        permission: "requirement:read",
        labelKey: "project.menu.requirements",
        icon: ClipboardList,
        group: "work",
        order: 35,
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

    // A persona's page reads "Acme › Requirements › Personas › #A2 Léa":
    // the tab, linked, then the persona as the inert leaf.
    this.shell.registerCrumb({
      order: 50,
      crumb: (ctx) =>
        ctx.routeName === "projectPersona"
          ? {
              labelKey: "requirements.tab.personas",
              href: ctx.path("projectPersonas", {
                projectSlug: ctx.projectSlug,
              }),
            }
          : undefined,
    });
    this.shell.registerCrumb({
      order: 51,
      reads: [currentPersonaAtom],
      crumb: (ctx) => {
        const persona = ctx.get(currentPersonaAtom);
        return ctx.routeName === "projectPersona" && persona
          ? {
              label: `${formatReference("persona", persona.number)} ${persona.name}`,
            }
          : undefined;
      },
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
  }
}
