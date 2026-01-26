import { t } from "alepha";
import {
  objectiveSchema,
  prioritySchema,
  projectParamsSchema,
  taskStatusSchema,
} from "./commonSchemas.ts";

// -----------------------------------------------------------------------------
// task_list
// -----------------------------------------------------------------------------

export const taskListParamsSchema = t.extend(projectParamsSchema, {
  status: t.optional(
    t.enum(["new", "accepted", "completed"], {
      description: "Filter by task status",
    }),
  ),
  search: t.optional(
    t.string({
      description: "Search tasks by title",
    }),
  ),
  limit: t.optional(
    t.integer({
      description: "Maximum number of tasks to return (default: 20)",
      minimum: 1,
      maximum: 100,
    }),
  ),
  offset: t.optional(
    t.integer({
      description: "Number of tasks to skip for pagination",
      minimum: 0,
    }),
  ),
});

export const taskListResultSchema = t.object({
  tasks: t.array(
    t.object({
      id: t.integer(),
      title: t.string(),
      description: t.string(),
      package: t.string(),
      priority: prioritySchema,
      complexity: t.integer(),
      status: taskStatusSchema,
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
// task_create
// -----------------------------------------------------------------------------

export const taskCreateParamsSchema = t.extend(projectParamsSchema, {
  title: t.string({
    description: "Task title",
  }),
  description: t.string({
    description: "Task description (supports HTML)",
  }),
  package: t.string({
    description: "Package/zone the task belongs to",
  }),
  priority: t.enum(["optional", "low", "medium", "high"], {
    description: "Task priority level",
  }),
  complexity: t.integer({
    description: "Task complexity (1-5)",
    minimum: 1,
    maximum: 5,
  }),
  objectives: t.optional(
    t.array(objectiveSchema, {
      description: "List of objectives/subtasks",
    }),
  ),
});

export const taskCreateResultSchema = t.object({
  id: t.integer(),
  title: t.string(),
  createdAt: t.datetime(),
});

// -----------------------------------------------------------------------------
// task_accept
// -----------------------------------------------------------------------------

export const taskAcceptParamsSchema = t.object({
  id: t.integer({
    description: "Task ID to accept",
  }),
});

export const taskAcceptResultSchema = t.object({
  id: t.integer(),
  title: t.string(),
  acceptedAt: t.datetime(),
});

// -----------------------------------------------------------------------------
// task_complete
// -----------------------------------------------------------------------------

export const taskCompleteParamsSchema = t.object({
  id: t.integer({
    description: "Task ID to complete",
  }),
});

export const taskCompleteResultSchema = t.object({
  id: t.integer(),
  title: t.string(),
  completedAt: t.datetime(),
  xpEarned: t.optional(t.integer()),
  moneyEarned: t.optional(t.integer()),
});

// -----------------------------------------------------------------------------
// task_update
// -----------------------------------------------------------------------------

export const taskUpdateParamsSchema = t.object({
  id: t.integer({
    description: "Task ID to update",
  }),
  title: t.optional(
    t.string({
      description: "New task title",
    }),
  ),
  description: t.optional(
    t.string({
      description: "New task description",
    }),
  ),
  package: t.optional(
    t.string({
      description: "New package/zone",
    }),
  ),
  priority: t.optional(
    t.enum(["optional", "low", "medium", "high"], {
      description: "New priority level",
    }),
  ),
  complexity: t.optional(
    t.integer({
      description: "New complexity (1-5)",
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

export const taskUpdateResultSchema = t.object({
  id: t.integer(),
  title: t.string(),
  updatedAt: t.datetime(),
});
