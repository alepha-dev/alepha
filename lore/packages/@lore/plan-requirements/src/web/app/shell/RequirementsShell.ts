import { ProjectShellRegistry } from "@lore/core/web";
import { $inject } from "alepha";
import { ClipboardList } from "lucide-react";

import { REQUIREMENTS_ROUTES } from "../components/layout/requirementsTabs.ts";

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
  }
}
