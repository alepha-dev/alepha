import { z } from "alepha";
import {
  campaignParamsSchema,
  entityRefSchema,
  objectiveSchema,
  prioritySchema,
  questStatusSchema,
} from "./commonSchemas.ts";

// -----------------------------------------------------------------------------
// Shared field descriptions
// -----------------------------------------------------------------------------

const PRIORITY_DESCRIPTION =
  "Quest priority. Ordered low → high: optional < low < medium < high. `optional` is below `low`.";
const DIFFICULTY_DESCRIPTION =
  "Quest difficulty from 1 (trivial) to 5 (epic). Higher means harder.";
const ZONE_DESCRIPTION =
  "Functional area or module within the campaign — analogous to an Epic in Jira, or a module/package in a codebase (e.g. 'auth', 'billing', 'ui'). Required (every quest must have a zone). Free-form string, NOT constrained to a pre-declared list — passing a new value implicitly registers it on the campaign on first use. Case-SENSITIVE: 'Auth' and 'auth' are distinct zones, so reuse the exact casing of existing ones. Call campaign_info to see the campaign's current zones before picking a value.";
const DESCRIPTION_DESCRIPTION =
  "Quest description in Markdown. Plain text also works. HTML is not supported and any tags will be stripped.";

// -----------------------------------------------------------------------------
// quest_list
// -----------------------------------------------------------------------------

export const questListParamsSchema = campaignParamsSchema.extend({
  status: questStatusSchema
    .describe(
      "Filter by quest status. Omit to list everything still in scope — shelved quests are excluded unless you ask for them explicitly.",
    )
    .optional(),
  search: z.string().describe("Search quests by title").optional(),
  tag: z
    .string()
    .describe(
      "Filter by a single tag (exact match against normalized — trimmed/lowercased — values). Call `quest_tags` first to discover what tags exist in the campaign.",
    )
    .optional(),
  limit: z
    .integer()
    .min(1)
    .max(100)
    .describe("Maximum number of quests to return (default: 20)")
    .optional(),
  offset: z
    .integer()
    .min(0)
    .describe("Number of quests to skip for pagination")
    .optional(),
});

export const questListResultSchema = z.object({
  quests: z.array(
    z.object({
      id: z.integer(),
      shortId: z.integer(),
      title: z.string(),
      description: z.string(),
      zone: z.string(),
      priority: prioritySchema,
      difficulty: z.integer(),
      status: questStatusSchema,
      objectives: z.array(objectiveSchema),
      tags: z.array(z.string()),
      createdAt: z.datetime(),
      acceptedAt: z.datetime().optional(),
      completedAt: z.datetime().optional(),
      shelvedAt: z.datetime().optional(),
    }),
  ),
  total: z.integer(),
  hasMore: z.boolean(),
});

// -----------------------------------------------------------------------------
// quest_get
// -----------------------------------------------------------------------------

export const questGetParamsSchema = entityRefSchema;

export const questGetResultSchema = z.object({
  id: z.integer(),
  shortId: z.integer(),
  title: z.string(),
  description: z.string(),
  zone: z.string(),
  priority: prioritySchema,
  difficulty: z.integer(),
  status: questStatusSchema,
  objectives: z.array(objectiveSchema),
  campaignId: z.integer(),
  chapterId: z.integer().optional(),
  createdAt: z.datetime(),
  updatedAt: z.datetime(),
  acceptedAt: z.datetime().optional(),
  completedAt: z.datetime().optional(),
  shelvedAt: z.datetime().optional(),
  completionMessage: z.string().optional(),
  completionMessageUpdatedAt: z.datetime().optional(),
  tags: z.array(z.string()),
  dependsOn_shortId: z.integer().optional(),
});

// -----------------------------------------------------------------------------
// quest_create
// -----------------------------------------------------------------------------

export const questCreateParamsSchema = campaignParamsSchema.extend({
  title: z.string().describe("Quest title"),
  description: z.string().describe(DESCRIPTION_DESCRIPTION),
  zone: z.string().describe(ZONE_DESCRIPTION),
  priority: z
    .enum(["optional", "low", "medium", "high"])
    .describe(PRIORITY_DESCRIPTION),
  difficulty: z.integer().min(1).max(5).describe(DIFFICULTY_DESCRIPTION),
  objectives: z
    .array(objectiveSchema)
    .describe("List of objectives/subquests")
    .optional(),
  tags: z
    .array(z.string())
    .describe(
      "Free-form labels for the **nature** of the quest (`bug`, `feat`, `chore`, `regression`, `quick-win`, …). Orthogonal to `zone` which labels the **module / scope**. Normalized server-side (trim, lowercase, dedupe). Reuse existing tags when possible — call `quest_tags` first.",
    )
    .optional(),
  dependsOn_shortId: z
    .integer()
    .describe(
      "Per-campaign shortId of a predecessor quest. While the predecessor is incomplete, `quest_accept` refuses to start this quest. Use to express 'this can't start until that one is done' (typical setup quest gating a follow-up).",
    )
    .optional(),
  petition_shortId: z
    .integer()
    .describe(
      "Per-campaign shortId of an ACCEPTED petition to link this quest to (it then shows under that petition's 'linked quests'). Owner-only; the petition must already be accepted (accept it first via petition_accept).",
    )
    .optional(),
  accept: z
    .boolean()
    .describe(
      "Immediately accept (assign to yourself) the quest right after it is created — the MCP equivalent of the UI's 'Create and accept' button, so an agent about to work the quest skips a separate quest_accept round-trip. Defaults to false. Best-effort: if the quest can't be accepted yet (e.g. it depends on an incomplete predecessor) it is still created and left in the 'new' lane, with `acceptNote` explaining why.",
    )
    .optional(),
});

export const questCreateResultSchema = z.object({
  id: z.integer(),
  shortId: z.integer(),
  title: z.string(),
  createdAt: z.datetime(),
  // Present (and `accept: true` was requested) when the accept landed —
  // the quest is in the 'accepted' lane, assigned to the caller.
  acceptedAt: z.datetime().optional(),
  // Present when `accept: true` was requested but the accept was refused
  // (e.g. blocked by an incomplete predecessor). The quest is still
  // created; this explains why it stayed in the 'new' lane.
  acceptNote: z.string().optional(),
});

// -----------------------------------------------------------------------------
// quest_accept
// -----------------------------------------------------------------------------

export const questAcceptParamsSchema = entityRefSchema;

export const questAcceptResultSchema = z.object({
  id: z.integer(),
  shortId: z.integer(),
  title: z.string(),
  acceptedAt: z.datetime(),
});

// -----------------------------------------------------------------------------
// quest_shelve / quest_unshelve
// -----------------------------------------------------------------------------

export const questShelveParamsSchema = entityRefSchema;

export const questShelveResultSchema = z.object({
  id: z.integer(),
  shortId: z.integer(),
  title: z.string(),
  shelvedAt: z.datetime(),
});

export const questUnshelveParamsSchema = entityRefSchema;

export const questUnshelveResultSchema = z.object({
  id: z.integer(),
  shortId: z.integer(),
  title: z.string(),
  status: questStatusSchema,
});

// -----------------------------------------------------------------------------
// quest_complete
// -----------------------------------------------------------------------------

export const questCompleteParamsSchema = entityRefSchema.extend({
  message: z
    .string()
    .describe(
      "Optional summary of what was accomplished — files touched, decisions made, anything a future reader (human or AI) would need to understand why this quest is closed. Markdown supported. Strongly encouraged: leave a trail so the next session has context.",
    )
    .optional(),
});

export const questCompleteResultSchema = z.object({
  id: z.integer(),
  shortId: z.integer(),
  title: z.string(),
  completedAt: z.datetime(),
});

// -----------------------------------------------------------------------------
// quest_update
// -----------------------------------------------------------------------------

export const questUpdateParamsSchema = entityRefSchema.extend({
  title: z.string().describe("New quest title").optional(),
  description: z.string().describe(`New ${DESCRIPTION_DESCRIPTION}`).optional(),
  zone: z.string().describe(`New ${ZONE_DESCRIPTION}`).optional(),
  priority: z
    .enum(["optional", "low", "medium", "high"])
    .describe(`New ${PRIORITY_DESCRIPTION}`)
    .optional(),
  difficulty: z
    .integer()
    .min(1)
    .max(5)
    .describe(`New ${DIFFICULTY_DESCRIPTION}`)
    .optional(),
  objectives: z
    .array(objectiveSchema)
    .describe(
      "Updated list of objectives. Pass the full new array (it REPLACES the existing one — omitted objectives will be deleted). Omit this field entirely to leave objectives unchanged.",
    )
    .optional(),
  completionMessage: z
    .string()
    .describe(
      "Rewrite the post-completion summary. Allowed on already-completed quests (the only field that is — other edits stay frozen). Pass an empty string to clear. Markdown supported.",
    )
    .optional(),
  tags: z
    .array(z.string())
    .describe(
      "Replace the quest's tags. Normalized server-side (trim, lowercase, dedupe). Pass an empty array to clear. Call `quest_tags` to discover existing tags.",
    )
    .optional(),
  dependsOn_shortId: z
    .integer()
    .describe(
      "Reparent the quest's predecessor to the quest with this per-campaign shortId (Questline). Pass 0 to clear the dependency. While a non-null predecessor is incomplete, `quest_accept` is blocked.",
    )
    .optional(),
  petition_shortId: z
    .integer()
    .describe(
      "Link this quest to the ACCEPTED petition with this per-campaign shortId (shows under that petition's 'linked quests'). Pass 0 to clear the link. Owner-only; the petition must already be accepted.",
    )
    .optional(),
});

export const questUpdateResultSchema = z.object({
  id: z.integer(),
  shortId: z.integer(),
  title: z.string(),
  updatedAt: z.datetime(),
});

// -----------------------------------------------------------------------------
// quest_tags
// -----------------------------------------------------------------------------

export const questTagsParamsSchema = campaignParamsSchema;

export const questTagsResultSchema = z.object({
  tags: z.array(z.string()),
});

// -----------------------------------------------------------------------------
// quest_delete
// -----------------------------------------------------------------------------

export const questDeleteParamsSchema = entityRefSchema;

export const questDeleteResultSchema = z.object({
  ok: z.boolean(),
});
