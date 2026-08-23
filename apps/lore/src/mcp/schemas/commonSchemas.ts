import { z } from "alepha";

import { questStatusSchema } from "../../api/schemas/questResourceSchema.ts";

/**
 * Quest priority levels.
 */
export const prioritySchema = z.enum(["optional", "low", "medium", "high"]);

/**
 * Quest size as the ordinal the column stores. The label mapping lives in the
 * field description rather than in the type, so the wire stays sortable and
 * an agent still knows that `4` means L.
 */
export const questSizeSchema = z.integer().min(1).max(5);

export { questStatusSchema };

/**
 * Epic lifecycle status. All transitions between the three are legal —
 * there is no forbidden edge (see `EpicController.setEpicStatus`).
 */
export const epicStatusSchema = z.enum(["planned", "active", "done"]);

/**
 * Quest objective, as a tool hands one out.
 *
 * `id` is required here and optional on the input side: the server mints one
 * for every objective and backfills legacy rows, so a read always carries it.
 * It is what `quest_objective_set` addresses and what the quest's own history
 * rows point at, which is why stripping it from the output (as this schema
 * used to) turned every objectives replace into a silent renumbering.
 */
export const objectiveSchema = z.object({
  id: z
    .integer()
    .describe(
      "Stable per-quest objective id. Pass it to `quest_objective_set` to tick one, and carry it back on `quest_update.objectives` so an edit stays an edit.",
    ),
  title: z.string(),
  completed: z.boolean(),
  waivedReason: z
    .string()
    .describe(
      "Why this objective was closed WITHOUT being done, recorded when the quest was completed. Present means the box is unticked on purpose: the work did not happen and this says why. Never set alongside `completed: true`.",
    )
    .optional(),
  waivedAt: z.datetime().optional(),
});

/**
 * Quest objective, as a tool accepts one.
 *
 * `id` optional so `quest_create` works with no ids at all, and so a
 * `quest_update` replace can mix kept objectives (carrying their id) with
 * brand-new ones (carrying none).
 */
export const objectiveInputSchema = z.object({
  id: z
    .integer()
    .min(0)
    .describe(
      "The id this objective already has, from `quest_get`. Carry it and the objective keeps its identity (and the history rows pointing at it stay true); omit it and a fresh objective is created. Omit on every item when creating a quest.",
    )
    .optional(),
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
