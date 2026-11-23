import { $inject, z } from "alepha";
import { $tool } from "alepha/mcp";
import { okSchema } from "alepha/server";

import { ProjectDashboardController } from "../../api/controllers/ProjectDashboardController.ts";
import { dashboardCardResourceSchema } from "../../api/schemas/dashboardCardResourceSchema.ts";
import { dashboardMetricEntrySchema } from "../../api/schemas/dashboardMetricEntrySchema.ts";
import { dashboardSummarySchema } from "../../api/schemas/dashboardSummarySchema.ts";
import {
  dashboardCardAddParamsSchema,
  dashboardCardListParamsSchema,
  dashboardCardRemoveParamsSchema,
  dashboardCardReorderParamsSchema,
  dashboardCardUpdateParamsSchema,
} from "../schemas/dashboardToolSchemas.ts";
import { projectParamsSchema } from "../schemas/projectParamsSchema.ts";
import { ProjectTools } from "./ProjectTools.ts";

/**
 * A project's dashboards over MCP (#Q4206), on the actions the board's edit
 * mode calls, so the gates are the web's: `project:read` to read,
 * `project:update` to write. The `lore dashboard` commands are the same
 * actions from a shell.
 *
 * A card's VALUES are not here: they are what the page renders, and an agent
 * reading numbers has the tools of the module that owns them.
 */
export class DashboardTools {
  protected readonly dashboards = $inject(ProjectDashboardController);
  protected readonly projects = $inject(ProjectTools);

  protected project(input: { project?: number; project_name?: string }) {
    return this.projects.resolveProjectId(input.project, input.project_name);
  }

  dashboard_list = $tool({
    title: "List dashboards",
    description:
      "A project's named dashboards, in order: id, name, slug, and which is the first. The first one with no stored card shows the computed board; dashboard_card_list then answers no card, and adding one replaces the computed board with what is stored.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: projectParamsSchema.strict(),
      result: z.object({ dashboards: z.array(dashboardSummarySchema) }),
    },
    handler: async ({ params }) =>
      this.dashboards.listProjectDashboards({
        params: { projectId: await this.project(params) },
      }),
  });

  dashboard_metric_catalog = $tool({
    title: "Dashboard metrics",
    description:
      "Every metric a project dashboard card can show: its key, the scope kinds it accepts (`apps` scopes a Ship card such as `uniqueVisitors` or `openErrors` to some apps, by sigil id), the JSON schema of its filters and their defaults, the capability it needs and the permission a reader needs. Read it before dashboard_card_add.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: projectParamsSchema.strict(),
      result: z.object({ metrics: z.array(dashboardMetricEntrySchema) }),
    },
    handler: async ({ params }) =>
      this.dashboards.listProjectDashboardMetrics({
        params: { projectId: await this.project(params) },
      }),
  });

  dashboard_card_list = $tool({
    title: "List dashboard cards",
    description:
      "The stored cards of a project dashboard, in grid order: id, metric, scope, filters, size, height, section. Empty on a first dashboard that shows the computed board.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: dashboardCardListParamsSchema.strict(),
      result: z.object({ cards: z.array(dashboardCardResourceSchema) }),
    },
    handler: async ({ params }) =>
      this.dashboards.listProjectDashboardCards({
        params: { projectId: await this.project(params) },
        query: { dashboardId: params.dashboard },
      }),
  });

  dashboard_card_add = $tool({
    title: "Add a dashboard card",
    description:
      "Add a card at the end of a project dashboard. Needs project:update. The metric must accept the scope's kind (dashboard_metric_catalog), and an app, epic or release in the scope must belong to the project.",
    annotations: { readOnlyHint: false, idempotentHint: false },
    schema: {
      params: dashboardCardAddParamsSchema.strict(),
      result: dashboardCardResourceSchema,
    },
    handler: async ({ params }) =>
      this.dashboards.addProjectDashboardCard({
        params: { projectId: await this.project(params) },
        query: { dashboardId: params.dashboard },
        body: {
          metric: params.metric,
          scope: params.scope ?? { kind: "projects" },
          ...(params.filters ? { filters: params.filters } : {}),
          ...(params.size ? { size: params.size } : {}),
          ...(params.height ? { height: params.height } : {}),
          ...(params.section !== undefined ? { section: params.section } : {}),
        },
      }),
  });

  dashboard_card_update = $tool({
    title: "Update a dashboard card",
    description:
      "Change a card's metric, scope, filters, size, height or section; what is omitted is left alone. Needs project:update.",
    annotations: { readOnlyHint: false, idempotentHint: true },
    schema: {
      params: dashboardCardUpdateParamsSchema.strict(),
      result: dashboardCardResourceSchema,
    },
    handler: async ({ params }) =>
      this.dashboards.updateProjectDashboardCard({
        params: {
          projectId: await this.project(params),
          cardId: params.card,
        },
        body: {
          ...(params.metric ? { metric: params.metric } : {}),
          ...(params.scope ? { scope: params.scope } : {}),
          ...(params.filters ? { filters: params.filters } : {}),
          ...(params.size ? { size: params.size } : {}),
          ...(params.height ? { height: params.height } : {}),
          ...(params.section !== undefined ? { section: params.section } : {}),
        },
      }),
  });

  dashboard_card_remove = $tool({
    title: "Remove a dashboard card",
    description: "Remove one card from its dashboard. Needs project:update.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    schema: {
      params: dashboardCardRemoveParamsSchema.strict(),
      result: okSchema,
    },
    handler: async ({ params }) =>
      this.dashboards.removeProjectDashboardCard({
        params: {
          projectId: await this.project(params),
          cardId: params.card,
        },
      }),
  });

  dashboard_card_reorder = $tool({
    title: "Reorder dashboard cards",
    description:
      "Put a dashboard's cards in a new order: `ids` is every card id of the dashboard, in the order wanted. Needs project:update. Answers the cards in their new order.",
    annotations: { readOnlyHint: false, idempotentHint: true },
    schema: {
      params: dashboardCardReorderParamsSchema.strict(),
      result: z.object({ cards: z.array(dashboardCardResourceSchema) }),
    },
    handler: async ({ params }) =>
      this.dashboards.reorderProjectDashboardCards({
        params: { projectId: await this.project(params) },
        query: { dashboardId: params.dashboard },
        body: { ids: params.ids },
      }),
  });
}
