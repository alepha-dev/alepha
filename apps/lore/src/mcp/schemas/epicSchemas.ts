import { z } from "alepha";

import { DIAGRAM_CAPABILITY } from "./diagramCapability.ts";
import { epicStatusSchema } from "./epicStatusSchema.ts";
import { projectParamsSchema } from "./projectParamsSchema.ts";

/**
 * Epic reference for MCP tools. Unlike quests (`id` / `shortId`) and
 * milestones (`id` / `number`), an epic has no dual reference — MCP
 * addresses it purely by its per-project `number` (mirrors the UI's
 * `/epics/:epicNumber` route and `EpicController.getEpicByNumber`).
 * `EpicController` exposes no id-only lookup, so `number` + project is the
 * only path in.
 */
const epicRefSchema = projectParamsSchema.extend({
  number: z
    .integer()
    .describe(
      "Per-project epic number ('Epic 3', from epic_list / epic_create).",
    ),
});

const epicProgressSchema = z.object({
  completed: z.integer(),
  total: z.integer(),
});

// -----------------------------------------------------------------------------
// epic_list
// -----------------------------------------------------------------------------

export const epicListParamsSchema = projectParamsSchema;

export const epicListResultSchema = z.object({
  epics: z.array(
    z.object({
      id: z.integer(),
      number: z.integer(),
      title: z.string(),
      description: z.string(),
      status: epicStatusSchema,
      questCount: z.integer(),
      progress: epicProgressSchema,
      createdAt: z.datetime(),
      activatedAt: z.datetime().optional(),
      completedAt: z.datetime().optional(),
    }),
  ),
});

// -----------------------------------------------------------------------------
// epic_get
// -----------------------------------------------------------------------------

export const epicGetParamsSchema = epicRefSchema;

export const epicGetResultSchema = z.object({
  id: z.integer(),
  number: z.integer(),
  title: z.string(),
  description: z.string(),
  status: epicStatusSchema,
  projectId: z.integer(),
  questCount: z.integer(),
  // Counts EVERY quest in the epic, planned-gated ones included — an epic's
  // own view of itself is never gated (design §5.3).
  progress: epicProgressSchema,
  createdAt: z.datetime(),
  activatedAt: z.datetime().optional(),
  completedAt: z.datetime().optional(),
  /**
   * The folios filed under this epic (pinned first, then newest-updated), capped at 100.
   * Bodies are not inlined: `folio_get` by `shortId`. An epic "owns quests
   * and folios"; the quests were reachable through `quest_list`'s `epic`
   * filter, the folios through nothing at all before this field.
   */
  folios: z.array(
    z.object({
      shortId: z.integer(),
      title: z.string(),
      summary: z.string().optional(),
      updatedAt: z.string(),
    }),
  ),
});

// -----------------------------------------------------------------------------
// epic_create
// -----------------------------------------------------------------------------

export const epicCreateParamsSchema = projectParamsSchema.extend({
  title: z.string().min(3).max(80).describe("Epic title"),
  description: z
    .string()
    .describe(
      `Epic description in Markdown. Plain text also works. HTML is not supported. ${DIAGRAM_CAPABILITY}`,
    )
    .optional(),
});

export const epicCreateResultSchema = z.object({
  id: z.integer(),
  number: z.integer(),
  title: z.string(),
  // Always "planned" — every epic is created there (see EpicController).
  status: epicStatusSchema,
  createdAt: z.datetime(),
});

// -----------------------------------------------------------------------------
// epic_update
// -----------------------------------------------------------------------------

export const epicUpdateParamsSchema = epicRefSchema.extend({
  title: z.string().min(3).max(80).describe("New epic title").optional(),
  description: z
    .string()
    .describe(`New epic description in Markdown. ${DIAGRAM_CAPABILITY}`)
    .optional(),
});

export const epicUpdateResultSchema = z.object({
  id: z.integer(),
  number: z.integer(),
  title: z.string(),
  updatedAt: z.datetime(),
});

// -----------------------------------------------------------------------------
// epic_set_status
// -----------------------------------------------------------------------------

export const epicSetStatusParamsSchema = epicRefSchema.extend({
  status: epicStatusSchema.describe(
    "New epic status. All transitions between planned/active/done are legal; there is no forbidden edge. Moving to `active` releases the epic's quests into the human-facing backlog/kanban/reports (quest_list already returns them regardless: MCP is not gated).",
  ),
});

export const epicSetStatusResultSchema = z.object({
  id: z.integer(),
  number: z.integer(),
  title: z.string(),
  status: epicStatusSchema,
  activatedAt: z.datetime().optional(),
  completedAt: z.datetime().optional(),
});
