import {
  ElementReferenceRegistry,
  lazyPart,
  ProjectShellRegistry,
} from "@lore/core/web";
import { $inject } from "alepha";
import { ClipboardList } from "lucide-react";

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
