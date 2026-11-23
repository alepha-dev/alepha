import { z } from "alepha";

import { dashboardScopeSchema } from "../../api/schemas/dashboardScopeSchema.ts";
import { projectParamsSchema } from "./projectParamsSchema.ts";

/**
 * The dashboard a card tool acts on (#Q4206); none is the project's first.
 */
const dashboardField = z
  .integer()
  .describe(
    "The dashboard's id, from dashboard_list. Omitted means the project's first dashboard.",
  )
  .optional();

const SCOPE_HELP =
  'What the card points at. `{ kind: "projects" }` is this project (the id is forced to it). `{ kind: "apps", sigilIds: [...] }` narrows to some of its apps, by the sigil ids sigil_list answers. `{ kind: "epic", epicId }` and `{ kind: "release", releaseId }` take the row id, not the number or tag. `{ kind: "viewer" }` is whoever reads the board. dashboard_metric_catalog says which kinds each metric accepts.';

const layoutFields = {
  filters: z
    .record(z.text(), z.any())
    .describe(
      "The metric's own filter values; dashboard_metric_catalog gives their JSON schema. Omitted takes the defaults.",
    )
    .optional(),
  size: z.integer().min(1).max(6).describe("Columns wide, 1 to 6.").optional(),
  height: z.integer().min(1).max(2).describe("Rows high, 1 or 2.").optional(),
  section: z
    .string()
    .max(60)
    .describe("The heading the card sits under.")
    .optional(),
};

export const dashboardCardListParamsSchema = projectParamsSchema.extend({
  dashboard: dashboardField,
});

export const dashboardCardAddParamsSchema = projectParamsSchema.extend({
  dashboard: dashboardField,
  metric: z
    .string()
    .min(1)
    .max(64)
    .describe(
      "The metric key, from dashboard_metric_catalog (`uniqueVisitors`, `openErrors`, `activeQuests`, ...).",
    ),
  scope: dashboardScopeSchema
    .describe(`${SCOPE_HELP} Omitted is the project itself.`)
    .optional(),
  ...layoutFields,
});

export const dashboardCardUpdateParamsSchema = projectParamsSchema.extend({
  card: z.integer().describe("The card's id, from dashboard_card_list."),
  metric: z.string().min(1).max(64).describe("A new metric key.").optional(),
  scope: dashboardScopeSchema.describe(SCOPE_HELP).optional(),
  ...layoutFields,
});

export const dashboardCardRemoveParamsSchema = projectParamsSchema.extend({
  card: z.integer().describe("The card's id, from dashboard_card_list."),
});

export const dashboardCardReorderParamsSchema = projectParamsSchema.extend({
  dashboard: dashboardField,
  ids: z
    .array(z.integer())
    .max(100)
    .describe(
      "Every card id of the dashboard, in the new order. A partial list is refused.",
    ),
});
