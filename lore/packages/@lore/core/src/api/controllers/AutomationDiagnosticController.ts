import { $inject, z } from "alepha";
import { $action } from "alepha/server";

import { automationDiagnosticPageSchema } from "../schemas/automationDiagnosticPageSchema.ts";
import { automationDiagnosticResourceSchema } from "../schemas/automationDiagnosticResourceSchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { AutomationAccess } from "../services/AutomationAccess.ts";
import { AutomationPersistence } from "../services/AutomationPersistence.ts";

/**
 * Owner-only rule metadata for the Settings diagnostic panel, readable while
 * Work or its `automations` option is off. Metadata only, never a rule body;
 * members read rules through `AutomationService`, which redacts by current
 * source access.
 */
export class AutomationDiagnosticController {
  protected readonly access = $inject(AutomationAccess);
  protected readonly persistence = $inject(AutomationPersistence);

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
