import { z } from "alepha";
import { questStatusSchema } from "../../api/schemas/questResourceSchema.ts";

/**
 * Quest priority levels.
 */
export const prioritySchema = z.enum(["optional", "low", "medium", "high"]);

export { questStatusSchema };

/**
 * Epic lifecycle status. All transitions between the three are legal —
 * there is no forbidden edge (see `EpicController.setEpicStatus`).
 */
export const epicStatusSchema = z.enum(["planned", "active", "done"]);

/**
 * Quest objective.
 */
export const objectiveSchema = z.object({
  title: z.string(),
  completed: z.boolean(),
});

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

/**
 * Entity reference for MCP tools. Tools accept EITHER:
 *   - `id` — the global, stable identifier (preferred for agents that
 *     persist references across sessions; immune to entity transfer).
 *   - `shortId` — the per-project 1-based id shown in URLs and UI
 *     ("#12"). When using `shortId`, the project context must be
 *     resolvable via `project` or `project_name`.
 *
 * Exactly one of `id` or `shortId` must be provided.
 */
export const entityRefSchema = z.object({
  id: z
    .integer()
    .describe(
      "Global entity ID (stable across sessions/projects). Mutually exclusive with shortId.",
    )
    .optional(),
  shortId: z
    .integer()
    .describe(
      "Per-project 1-based shortId (the '#12' you see in URLs and UI). Requires `project` or `project_name` to disambiguate.",
    )
    .optional(),
  project: z
    .integer()
    .describe("Project ID — required when using `shortId`.")
    .optional(),
  project_name: z
    .string()
    .describe(
      "Project name (case-insensitive) — required when using `shortId` if `project` not provided.",
    )
    .optional(),
});
