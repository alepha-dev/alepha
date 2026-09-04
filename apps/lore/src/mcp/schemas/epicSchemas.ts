import { z } from "alepha";

import { DIAGRAM_CAPABILITY } from "./diagramCapability.ts";
import { diagramWarningsShape } from "./diagramWarningsSchema.ts";
import { epicStatusSchema } from "./epicStatusSchema.ts";
import { projectParamsSchema } from "./projectParamsSchema.ts";

/**
 * Epic reference for MCP tools. Unlike quests (`id` / `shortId`) and
 * releases (`id` / `number`), an epic has no dual reference — MCP
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
      dependsOn_number: z
        .integer()
        .describe(
          "Per-project number of the epic that has to come first, if any. ADVISORY: nothing refuses a status change because of it. It is what the roadmap draws the order from - see `epics.dependsOn`.",
        )
        .optional(),
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
  dependsOn_number: z
    .integer()
    .describe(
      "Per-project number of the epic that has to come first, if any. ADVISORY: nothing refuses a status change because of it - it is what the roadmap draws the order from.",
    )
    .optional(),
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
  dependsOn_number: z
    .integer()
    .describe(
      "Per-project number of an epic that has to come first. ADVISORY - unlike a quest's `dependsOn_shortId`, this refuses nothing: epics overlap by design, and the roadmap draws the order rather than enforcing it. Cycles ARE refused. Write the order here instead of in the description; prose cannot be rendered or sorted.",
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
  ...diagramWarningsShape,
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
  dependsOn_number: z
    .integer()
    .describe(
      "Reparent the epic's predecessor to the epic with this per-project number. Pass 0 to clear it. ADVISORY: nothing is refused because of it, but cycles are.",
    )
    .optional(),
});

export const epicUpdateResultSchema = z.object({
  id: z.integer(),
  number: z.integer(),
  title: z.string(),
  updatedAt: z.datetime(),
  ...diagramWarningsShape,
});

// -----------------------------------------------------------------------------
// epic_set_status
// -----------------------------------------------------------------------------

export const epicSetStatusParamsSchema = epicRefSchema.extend({
  status: epicStatusSchema.describe(
    "New epic status. Only two edges are legal: `active` from `planned` (Begin), and `done` from `active` (Conclude); `done` is terminal, and the same status again is a no-op. Moving to `active` releases the epic's quests into the human-facing backlog/kanban/reports and into quest_list's default view.",
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

// -----------------------------------------------------------------------------
// epic_delete
// -----------------------------------------------------------------------------

export const epicDeleteParamsSchema = epicRefSchema;

/**
 * Bare acknowledgement, like `quest_delete`. Nothing about the epic is worth
 * echoing back once it is gone, and the counts that WOULD be interesting
 * (how many quests and folios were detached) are deliberately not returned:
 * `EpicController.deleteEpic` leaves the orphaning to the FK's
 * `ON DELETE SET NULL`, so no application code ever sees those rows and any
 * number here would have to be produced by a query written purely to
 * populate it.
 */
export const epicDeleteResultSchema = z.object({
  ok: z.boolean(),
});
