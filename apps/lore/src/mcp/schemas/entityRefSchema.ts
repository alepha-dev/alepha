import { z } from "alepha";

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
