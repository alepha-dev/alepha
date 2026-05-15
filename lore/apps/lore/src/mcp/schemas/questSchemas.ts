import { t } from "alepha";
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
  "Quest difficulty from 1 (trivial) to 5 (epic). Higher means harder; affects XP and gold rewards.";
const ZONE_DESCRIPTION =
  "Functional area or module within the campaign — analogous to an Epic in Jira, or a module/package in a codebase (e.g. 'auth', 'billing', 'ui'). Required (every quest must have a zone). Free-form string, NOT constrained to a pre-declared list — passing a new value implicitly registers it on the campaign on first use. Case-SENSITIVE: 'Auth' and 'auth' are distinct zones, so reuse the exact casing of existing ones. Call campaign_info to see the campaign's current zones before picking a value.";
const DESCRIPTION_DESCRIPTION =
  "Quest description in Markdown. Plain text also works. HTML is not supported and any tags will be stripped.";

// -----------------------------------------------------------------------------
// quest_list
// -----------------------------------------------------------------------------

export const questListParamsSchema = t.extend(campaignParamsSchema, {
  status: t.optional(
    t.enum(["new", "accepted", "completed"], {
      description: "Filter by quest status",
    }),
  ),
  search: t.optional(
    t.string({
      description: "Search quests by title",
    }),
  ),
  limit: t.optional(
    t.integer({
      description: "Maximum number of quests to return (default: 20)",
      minimum: 1,
      maximum: 100,
    }),
  ),
  offset: t.optional(
    t.integer({
      description: "Number of quests to skip for pagination",
      minimum: 0,
    }),
  ),
});

export const questListResultSchema = t.object({
  quests: t.array(
    t.object({
      id: t.integer(),
      shortId: t.integer(),
      title: t.string(),
      description: t.string(),
      zone: t.string(),
      priority: prioritySchema,
      difficulty: t.integer(),
      status: questStatusSchema,
      objectives: t.array(objectiveSchema),
      createdAt: t.datetime(),
      acceptedAt: t.optional(t.datetime()),
      completedAt: t.optional(t.datetime()),
    }),
  ),
  total: t.integer(),
  hasMore: t.boolean(),
});

// -----------------------------------------------------------------------------
// quest_get
// -----------------------------------------------------------------------------

export const questGetParamsSchema = entityRefSchema;

export const questGetResultSchema = t.object({
  id: t.integer(),
  shortId: t.integer(),
  title: t.string(),
  description: t.string(),
  zone: t.string(),
  priority: prioritySchema,
  difficulty: t.integer(),
  status: questStatusSchema,
  objectives: t.array(objectiveSchema),
  campaignId: t.integer(),
  chapterId: t.optional(t.integer()),
  createdAt: t.datetime(),
  updatedAt: t.datetime(),
  acceptedAt: t.optional(t.datetime()),
  completedAt: t.optional(t.datetime()),
  completionMessage: t.optional(t.string()),
  completionMessageUpdatedAt: t.optional(t.datetime()),
});

// -----------------------------------------------------------------------------
// quest_create
// -----------------------------------------------------------------------------

export const questCreateParamsSchema = t.extend(campaignParamsSchema, {
  title: t.string({
    description: "Quest title",
  }),
  description: t.string({
    description: DESCRIPTION_DESCRIPTION,
  }),
  zone: t.string({
    description: ZONE_DESCRIPTION,
  }),
  priority: t.enum(["optional", "low", "medium", "high"], {
    description: PRIORITY_DESCRIPTION,
  }),
  difficulty: t.integer({
    description: DIFFICULTY_DESCRIPTION,
    minimum: 1,
    maximum: 5,
  }),
  objectives: t.optional(
    t.array(objectiveSchema, {
      description: "List of objectives/subquests",
    }),
  ),
});

export const questCreateResultSchema = t.object({
  id: t.integer(),
  shortId: t.integer(),
  title: t.string(),
  createdAt: t.datetime(),
});

// -----------------------------------------------------------------------------
// quest_accept
// -----------------------------------------------------------------------------

export const questAcceptParamsSchema = entityRefSchema;

export const questAcceptResultSchema = t.object({
  id: t.integer(),
  shortId: t.integer(),
  title: t.string(),
  acceptedAt: t.datetime(),
});

// -----------------------------------------------------------------------------
// quest_complete
// -----------------------------------------------------------------------------

export const questCompleteParamsSchema = t.extend(entityRefSchema, {
  message: t.optional(
    t.string({
      description:
        "Optional summary of what was accomplished — files touched, decisions made, anything a future reader (human or AI) would need to understand why this quest is closed. Markdown supported. Strongly encouraged: leave a trail so the next session has context.",
    }),
  ),
});

export const questCompleteResultSchema = t.object({
  id: t.integer(),
  shortId: t.integer(),
  title: t.string(),
  completedAt: t.datetime(),
  xpEarned: t.optional(t.integer()),
  moneyEarned: t.optional(t.integer()),
});

// -----------------------------------------------------------------------------
// quest_update
// -----------------------------------------------------------------------------

export const questUpdateParamsSchema = t.extend(entityRefSchema, {
  title: t.optional(
    t.string({
      description: "New quest title",
    }),
  ),
  description: t.optional(
    t.string({
      description: `New ${DESCRIPTION_DESCRIPTION}`,
    }),
  ),
  zone: t.optional(
    t.string({
      description: `New ${ZONE_DESCRIPTION}`,
    }),
  ),
  priority: t.optional(
    t.enum(["optional", "low", "medium", "high"], {
      description: `New ${PRIORITY_DESCRIPTION}`,
    }),
  ),
  difficulty: t.optional(
    t.integer({
      description: `New ${DIFFICULTY_DESCRIPTION}`,
      minimum: 1,
      maximum: 5,
    }),
  ),
  objectives: t.optional(
    t.array(objectiveSchema, {
      description:
        "Updated list of objectives. Pass the full new array (it REPLACES the existing one — omitted objectives will be deleted). Omit this field entirely to leave objectives unchanged.",
    }),
  ),
  completionMessage: t.optional(
    t.string({
      description:
        "Rewrite the post-completion summary. Allowed on already-completed quests (the only field that is — other edits stay frozen). Pass an empty string to clear. Markdown supported.",
    }),
  ),
});

export const questUpdateResultSchema = t.object({
  id: t.integer(),
  shortId: t.integer(),
  title: t.string(),
  updatedAt: t.datetime(),
});

// -----------------------------------------------------------------------------
// quest_delete
// -----------------------------------------------------------------------------

export const questDeleteParamsSchema = entityRefSchema;

export const questDeleteResultSchema = t.object({
  ok: t.boolean(),
});
