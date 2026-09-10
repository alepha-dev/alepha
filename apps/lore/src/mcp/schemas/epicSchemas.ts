import { z } from "alepha";

import { epicManualStatusSchema } from "../../api/schemas/epicManualStatusSchema.ts";
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
      startedAt: z.datetime().optional(),
      completedAt: z.datetime().optional(),
      dependsOn_number: z
        .integer()
        .describe(
          "Per-project number of the epic that has to come first, if any. A gate: no quest of this epic can be accepted, so the epic cannot start, while that epic is not 'completed'. It is also what the roadmap draws the order from - see `epics.dependsOn`.",
        )
        .optional(),
      dependsOn_status: epicStatusSchema
        .describe(
          "The predecessor's status, present exactly when dependsOn_number is. Anything but 'completed' means this epic cannot start yet.",
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
  startedAt: z.datetime().optional(),
  completedAt: z.datetime().optional(),
  dependsOn_number: z
    .integer()
    .describe(
      "Per-project number of the epic that has to come first, if any. A gate: no quest of this epic can be accepted, so the epic cannot start, while that epic is not 'completed'. It is also what the roadmap draws the order from.",
    )
    .optional(),
  dependsOn_status: epicStatusSchema
    .describe(
      "The predecessor's status, present exactly when dependsOn_number is. Anything but 'completed' means this epic cannot start yet.",
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
      "Per-project number of an epic that has to come first. A gate, like a quest's `dependsOn_shortId`: no quest of this epic can be accepted while that epic is not 'completed', so this epic cannot start. It can still be marked 'ready', which lets a whole chain be specified at once. Record a predecessor only when this epic genuinely cannot start before the other completes. Cycles are refused on write. Write the order here instead of in the description; prose cannot be rendered, sorted or enforced.",
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
      "Reparent the epic's predecessor to the epic with this per-project number. Pass 0 to clear it. A gate: no quest of this epic can be accepted, so the epic cannot start, while the predecessor is not 'completed'. Writable in every status; the gate is evaluated when the epic starts, and only then. Cycles are refused on write.",
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
  status: epicManualStatusSchema.describe(
    "`ready` (the spec is done: the quests join the backlog and can be accepted) or `planned` (back to specifying: the quests leave the backlog again). Only those two, and only between each other. `in_progress` and `completed` are never set by hand: the first quest accepted or assigned starts the epic, and the last open quest completed or shelved completes it. The same status again is a no-op.",
  ),
});

export const epicSetStatusResultSchema = z.object({
  id: z.integer(),
  number: z.integer(),
  title: z.string(),
  status: epicStatusSchema,
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
