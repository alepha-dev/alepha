import {
  DIAGRAM_CAPABILITY,
  diagramWarningsShape,
  epicStatusSchema,
  projectParamsSchema,
} from "@lore/core/schemas";
import { z } from "alepha";

import { epicManualStatusSchema } from "../../api/schemas/epicManualStatusSchema.ts";
import { epicReviewItemInputSchema } from "../../api/schemas/epicReviewItemInputSchema.ts";
import { epicReviewItemKindSchema } from "../../api/schemas/epicReviewItemKindSchema.ts";
import { epicReviewSuggestionSchema } from "../../api/schemas/epicReviewSuggestionSchema.ts";

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
// epic_get's `review` (#E121)
// -----------------------------------------------------------------------------

/**
 * What `epic_get` inlines about an epic's reviews, so neither prompt needs a
 * second call: every open question in full, and the decision log one line
 * each, bounded (the oldest past the cap go behind `logOmitted`).
 */
export const epicGetReviewSchema = z.object({
  openQuestions: z
    .array(
      z.object({
        number: z.integer(),
        title: z.string(),
        context: z.string().optional(),
        suggestions: z.array(epicReviewSuggestionSchema),
        recommended: z.integer().optional(),
      }),
    )
    .describe(
      "Review questions still open. They are the owner's to answer: never answer one yourself.",
    ),
  log: z
    .array(z.string())
    .describe(
      "The decision log, oldest first, one line each: every answered question with its answer and every decision that stands. Binding: do not ask again what is answered here, and do not reverse a decision without filing a new decision that says so.",
    ),
  logOmitted: z
    .integer()
    .describe("How many older log entries were left out to keep this short.")
    .optional(),
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
  // Counts EVERY quest in the epic, draft-gated ones included — an epic's
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
  review: epicGetReviewSchema.describe(
    "What the epic's plan reviews left: the questions still open, and the decision log. Read it before reviewing or working the epic.",
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
  // Always "draft" — every epic is created there (see EpicController).
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
    "`ready` (the spec is done: the quests join the backlog and can be accepted) or `draft` (back to specifying: the quests leave the backlog again). Only those two, and only between each other. `in_progress` and `completed` are never set by hand: the first quest accepted or assigned starts the epic, and the last open quest completed or shelved completes it. `shelved` has its own tools, epic_shelve and epic_unshelve. The same status again is a no-op.",
  ),
});

export const epicSetStatusResultSchema = z.object({
  id: z.integer(),
  number: z.integer(),
  title: z.string(),
  status: epicStatusSchema,
  openQuestions: z
    .integer()
    .describe(
      "Review questions still open on the epic. Never a refusal: report them to the owner, whose call it is whether the spec is done.",
    ),
});

// -----------------------------------------------------------------------------
// epic_shelve / epic_unshelve
// -----------------------------------------------------------------------------

export const epicShelveParamsSchema = epicRefSchema;

/**
 * The epic's status after the move, and how many of its quests moved: the
 * number an agent reports back (#E78).
 */
export const epicShelveResultSchema = z.object({
  id: z.integer(),
  number: z.integer(),
  title: z.string(),
  status: epicStatusSchema,
  movedQuests: z
    .integer()
    .describe(
      "How many quests this call shelved (epic_shelve) or brought back (epic_unshelve).",
    ),
});

// -----------------------------------------------------------------------------
// epic_delete
// -----------------------------------------------------------------------------

export const epicDeleteParamsSchema = epicRefSchema;

/**
 * Acknowledgement, like `quest_delete`, plus the one number an agent needs
 * to report what it just did: how many quests went with the epic (#Q2667).
 * `EpicController.deleteEpic` answers it as `count`; its folios are unfiled,
 * never deleted, so they are not counted.
 */
export const epicDeleteResultSchema = z.object({
  ok: z.boolean(),
  deletedQuests: z
    .integer()
    .describe("How many quests were deleted with the epic."),
});
// -----------------------------------------------------------------------------
// epic_review_create
// -----------------------------------------------------------------------------

export const epicReviewCreateParamsSchema = epicRefSchema.extend({
  summary: z
    .string()
    .max(2000)
    .describe("What the review concluded, in a line or two.")
    .optional(),
  items: z
    .array(epicReviewItemInputSchema)
    .max(100)
    .describe(
      "Every question, decision and change of this review, in one call. An empty list is a valid review: do not invent an item to look thorough.",
    ),
});

export const epicReviewCreateResultSchema = z.object({
  review: z.integer().describe("The review's id."),
  items: z
    .array(
      z.object({
        number: z.integer(),
        kind: epicReviewItemKindSchema,
        title: z.string(),
      }),
    )
    .describe(
      "Each item with the number it was given, per epic. Quote these numbers in your reply.",
    ),
});

// -----------------------------------------------------------------------------
// epic_review_answer
// -----------------------------------------------------------------------------

export const epicReviewAnswerParamsSchema = epicRefSchema.extend({
  item: z
    .integer()
    .min(1)
    .describe(
      "The item's number, per epic, as the review and epic_get show it.",
    ),
  answer: z
    .string()
    .describe(
      "The owner's answer in their words. On a decision, the decision that replaces it.",
    )
    .optional(),
  suggestion: z
    .integer()
    .min(0)
    .describe("Pick one of the item's suggestions instead, by index from 0.")
    .optional(),
  waive: z
    .boolean()
    .describe(
      "Set a question aside unanswered. A decision cannot be waived, only overturned.",
    )
    .optional(),
});

export const epicReviewAnswerToolResultSchema = z.object({
  item: z.integer(),
  outcome: z.enum(["answered", "waived", "overturned"]),
  answer: z.string().optional(),
  replacement: z
    .integer()
    .describe("On an overturn: the number of the decision filed in its place.")
    .optional(),
});
