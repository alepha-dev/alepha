import { $inject, Alepha, z } from "alepha";
import { NotFoundError } from "alepha/server";

import { $pageProject } from "./$pageProject.ts";
import { currentProjectAtom } from "./atoms/currentProjectAtom.ts";
import { canInProject } from "./services/projectRank.ts";

/**
 * Automations are Core (#Q3629): every project has these pages, and the
 * automation permissions alone decide who reaches them.
 */
export class AutomationRouter {
  protected readonly alepha = $inject(Alepha);
  projectAutomations = $pageProject({
    name: "projectAutomations",
    path: "/automations",
    lazy: () =>
      import("./components/project/automations/AutomationOverviewPage.tsx"),
    loader: async () => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!canInProject(project, "automation:read"))
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
        !canInProject(project, "automation:read") ||
        !canInProject(project, "automation:write")
      )
        throw new NotFoundError(
          "Automation presets are not available for this project and rank",
        );
    },
  });
  /**
   * A new automation built in the editor (#Q3812): empty, or a preset's
   * graph as an unsaved draft (`?preset=`, its graph in
   * `automationDraftAtom`). A static child, tried before `:automationId`.
   */
  projectAutomationNew = $pageProject({
    name: "projectAutomationNew",
    path: "/automations/new",
    schema: { query: z.object({ preset: z.string().max(128).optional() }) },
    lazy: () =>
      import("./components/project/automations/AutomationNewPage.tsx"),
    loader: ({ query }) => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (
        !canInProject(project, "automation:read") ||
        !canInProject(project, "automation:write")
      )
        throw new NotFoundError(
          "Automations cannot be created in this project with this rank",
        );
      return { preset: query.preset };
    },
  });
  projectAutomationVariables = $pageProject({
    name: "projectAutomationVariables",
    path: "/automations/variables",
    schema: { query: z.object({ key: z.string().max(64).optional() }) },
    lazy: () =>
      import("./components/project/automations/AutomationVariablesPage.tsx"),
    loader: ({ query }) => {
      this.checkRead();
      return { variableKey: query.key };
    },
  });
  projectAutomationRun = $pageProject({
    name: "projectAutomationRun",
    path: "/automations/runs/:runId",
    schema: { params: z.object({ projectSlug: z.string(), runId: z.uuid() }) },
    lazy: () =>
      import("./components/project/automations/AutomationRunPage.tsx"),
    loader: ({ params }) => {
      this.checkRead();
      return { runId: params.runId };
    },
  });
  projectAutomationDetail = $pageProject({
    name: "projectAutomationDetail",
    path: "/automations/:automationId",
    schema: {
      params: z.object({ projectSlug: z.string(), automationId: z.uuid() }),
    },
    lazy: () =>
      import("./components/project/automations/AutomationDetailPage.tsx"),
    loader: ({ params }) => {
      this.checkRead();
      return { automationId: params.automationId };
    },
  });
  protected checkRead(): void {
    const project = this.alepha.store.get(currentProjectAtom);
    if (!canInProject(project, "automation:read"))
      throw new NotFoundError(
        "Automations are not available for this project and rank",
      );
  }
}
