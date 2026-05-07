import { t } from "alepha";
import {
  campaignParamsSchema,
  objectiveSchema,
  prioritySchema,
  questStatusSchema,
} from "./commonSchemas.ts";

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
// quest_create
// -----------------------------------------------------------------------------

export const questCreateParamsSchema = t.extend(campaignParamsSchema, {
  title: t.string({
    description: "Quest title",
  }),
  description: t.string({
    description: "Quest description (supports HTML)",
  }),
  zone: t.string({
    description: "Zone/zone the quest belongs to",
  }),
  priority: t.enum(["optional", "low", "medium", "high"], {
    description: "Quest priority level",
  }),
  difficulty: t.integer({
    description: "Quest difficulty (1-5)",
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
  title: t.string(),
  createdAt: t.datetime(),
});

// -----------------------------------------------------------------------------
// quest_accept
// -----------------------------------------------------------------------------

export const questAcceptParamsSchema = t.object({
  id: t.integer({
    description: "Quest ID to accept",
  }),
});

export const questAcceptResultSchema = t.object({
  id: t.integer(),
  title: t.string(),
  acceptedAt: t.datetime(),
});

// -----------------------------------------------------------------------------
// quest_complete
// -----------------------------------------------------------------------------

export const questCompleteParamsSchema = t.object({
  id: t.integer({
    description: "Quest ID to complete",
  }),
});

export const questCompleteResultSchema = t.object({
  id: t.integer(),
  title: t.string(),
  completedAt: t.datetime(),
  xpEarned: t.optional(t.integer()),
  moneyEarned: t.optional(t.integer()),
});

// -----------------------------------------------------------------------------
// quest_update
// -----------------------------------------------------------------------------

export const questUpdateParamsSchema = t.object({
  id: t.integer({
    description: "Quest ID to update",
  }),
  title: t.optional(
    t.string({
      description: "New quest title",
    }),
  ),
  description: t.optional(
    t.string({
      description: "New quest description",
    }),
  ),
  zone: t.optional(
    t.string({
      description: "New zone/zone",
    }),
  ),
  priority: t.optional(
    t.enum(["optional", "low", "medium", "high"], {
      description: "New priority level",
    }),
  ),
  difficulty: t.optional(
    t.integer({
      description: "New difficulty (1-5)",
      minimum: 1,
      maximum: 5,
    }),
  ),
  objectives: t.optional(
    t.array(objectiveSchema, {
      description: "Updated list of objectives",
    }),
  ),
});

export const questUpdateResultSchema = t.object({
  id: t.integer(),
  title: t.string(),
  updatedAt: t.datetime(),
});
