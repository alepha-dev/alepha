import { t } from "alepha";
import { taskStatusSchema } from "../../api/schemas/taskResourceSchema.ts";

/**
 * Task priority levels.
 */
export const prioritySchema = t.enum(["optional", "low", "medium", "high"]);

export { taskStatusSchema };

/**
 * Task objective.
 */
export const objectiveSchema = t.object({
  title: t.string(),
  completed: t.boolean(),
});

/**
 * Common project identification params for MCP tools.
 * Either project ID or project_name must be provided.
 */
export const projectParamsSchema = t.object({
  project: t.optional(
    t.integer({
      description: "Project ID. Required if project_name is not provided.",
    }),
  ),
  project_name: t.optional(
    t.string({
      description:
        "Project name (campaign title). Case-insensitive. Required if project is not provided.",
    }),
  ),
});
