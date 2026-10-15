import { $inject, Alepha } from "alepha";
import { NotFoundError } from "alepha/server";

import { $pageProject } from "./$pageProject.ts";
import { currentProjectAtom } from "./atoms/currentProjectAtom.ts";
import { capabilityOption } from "./services/projectCapabilities.ts";
import { canInProject } from "./services/projectRank.ts";

export class AutomationRouter {
  protected readonly alepha = $inject(Alepha);
  projectAutomations = $pageProject({
    name: "projectAutomations",
    path: "/automations",
    lazy: () =>
      import("./components/project/automations/AutomationOverviewPage.tsx"),
    loader: async () => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (
        !capabilityOption(project, "work", "automations") ||
        !canInProject(project, "automation:read")
      )
        throw new NotFoundError(
          "Automations are not available for this project and rank",
        );
    },
  });
  projectAutomationGallery = $pageProject({
    name: "projectAutomationGallery",
    path: "/automations/presets",
    lazy: () =>
      import("./components/project/automations/AutomationGalleryPage.tsx"),
    loader: async () => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (
        !capabilityOption(project, "work", "automations") ||
        !canInProject(project, "automation:read") ||
        !canInProject(project, "automation:write")
      )
        throw new NotFoundError(
          "Automation presets are not available for this project and rank",
        );
    },
  });
}
