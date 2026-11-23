import {
  capabilityOption,
  CommitLinkRegistry,
  currentProjectAtom,
  hasCapability,
  ProjectShellRegistry,
  ReportsTabRegistry,
} from "@lore/core/web";
import { $inject } from "alepha";
import { FlaskConical, FolderGit2 } from "lucide-react";

import { useCodeCommitHref } from "../components/project/code/useCodeCommitHref.ts";

/**
 * Build's part of the project shell (#E162): the Quality tab of Reports,
 * General's Quality settings tab (#Q4059), and Build's band in the sidebar
 * (#Q4133): Code, and Quality, which opens the Reports tab.
 */
export class BuildShell {
  protected readonly reports = $inject(ReportsTabRegistry);
  protected readonly shell = $inject(ProjectShellRegistry);
  protected readonly commitLinks = $inject(CommitLinkRegistry);

  constructor() {
    // A commit on a quest or an artifact links into its Lore repository
    // (#Q4136): Build is the one that knows the repositories.
    this.commitLinks.register(useCodeCommitHref);

    // Build's own band (review #130 item 2). CI and Pull requests join it
    // with their epics, through `extendNav` and their own `order`.
    this.shell.registerNav("build", [
      {
        route: "projectCode",
        labelKey: "project.menu.code",
        icon: FolderGit2,
        group: "build",
        order: 10,
        option: "repositories",
        permission: "code:read",
        activeOn: (name) =>
          name === "projectCode" ||
          name === "projectCodeRepo" ||
          name.startsWith("codeRepo"),
      },
      {
        // The Reports tab, which stays where it is: this entry only opens it.
        // Hidden with Reports off, whose page is the tab's parent and 404s.
        route: "reportsQuality",
        labelKey: "project.reports.nav.quality",
        icon: FlaskConical,
        group: "build",
        order: 20,
        option: "quality",
        permission: "quality:read",
        reads: [currentProjectAtom],
        available: (context) =>
          hasCapability(context.get(currentProjectAtom), "reports"),
      },
    ]);

    // Quality is its own tab (#Q3070), right after Delivery. It shows for
    // every Build project, with the push command until CI sends a run; a
    // project without Build shows none, not even the empty state (#E162).
    this.reports.register({
      route: "reportsQuality",
      labelKey: "project.reports.nav.quality",
      order: 9.85,
      needs: "build",
      // Quality is an option of Build since #Q4005.
      option: "quality",
      filters: ["period", "branch"],
    });

    // The coverage settings (#Q4059): General's, since Build has no section
    // of its own, and listed while Quality is on.
    this.shell.registerSettingsTab("general", {
      route: "projectSettingsQuality",
      labelKey: "project.settings.tab.quality",
      capability: "build",
      visible: (project) => capabilityOption(project, "build", "quality"),
    });
  }
}
