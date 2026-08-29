import { z } from "alepha";

/**
 * Common project identification params for MCP tools.
 * Either project ID or project_name must be provided. If both are passed,
 * `project` (the ID) wins.
 */
export const projectParamsSchema = z.object({
  project: z
    .integer()
    .describe(
      "Project ID. Required if project_name is not provided. Takes precedence if both are provided.",
    )
    .optional(),
  project_name: z
    .string()
    .describe(
      "Project name (project title). Case-insensitive. Required if project is not provided. Ignored when project is also provided.",
    )
    .optional(),
});
