import { $inject, z } from "alepha";
import { $action } from "alepha/server";

import { automationDiagnosticPageSchema } from "../schemas/automationDiagnosticPageSchema.ts";
import { automationDiagnosticResourceSchema } from "../schemas/automationDiagnosticResourceSchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { AutomationAccess } from "../services/AutomationAccess.ts";
import { AutomationPersistence } from "../services/AutomationPersistence.ts";

export class AutomationDiagnosticController {
  protected readonly access = $inject(AutomationAccess);
  protected readonly persistence = $inject(AutomationPersistence);

  getAutomationSummaries = $action({
    use: [
      $ownsProject({
        param: "projectId",
        requires: "automation:read",
        capability: { key: "work", option: "automations" },
      }),
    ],
    method: "GET",
    path: "/projects/:projectId/automation-summaries",
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: z.object({ offset: z.integer().nonnegative().default(0) }),
      response: automationDiagnosticPageSchema,
    },
    handler: async ({ params, query, user }) => {
      await this.access.assert(params.projectId, user, "automation:read");
      return this.list(params.projectId, query.offset);
    },
  });

  protected async list(projectId: number, offset: number) {
    const rows = await this.persistence.rules.findMany({
      where: { projectId },
      columns: [
        "id",
        "title",
        "authorUserId",
        "enabled",
        "health",
        "reason",
        "requiresApproval",
        "revision",
        "updatedAt",
      ],
      orderBy: { column: "id", direction: "asc" },
      offset,
      limit: 51,
    });
    return {
      items: rows
        .slice(0, 50)
        .map((row) => automationDiagnosticResourceSchema.parse(row)),
      hasMore: rows.length > 50,
    };
  }

  getAutomationDiagnostics = $action({
    use: [$ownsProject({ param: "projectId", requires: "capability:manage" })],
    method: "GET",
    path: "/projects/:projectId/automation-diagnostics",
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: z.object({ offset: z.integer().nonnegative().default(0) }),
      response: automationDiagnosticPageSchema,
    },
    handler: async ({ params, query, user }) => {
      await this.access.assertOwner(params.projectId, user);
      return this.list(params.projectId, query.offset);
    },
  });
}
