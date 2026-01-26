import { t } from "alepha";
import { prioritySchema, projectParamsSchema } from "./commonSchemas.ts";

// -----------------------------------------------------------------------------
// project_list
// -----------------------------------------------------------------------------

export const projectListResultSchema = t.object({
  projects: t.array(
    t.object({
      id: t.integer(),
      title: t.string(),
      public: t.boolean(),
      isOwner: t.boolean(),
    }),
  ),
});

// -----------------------------------------------------------------------------
// project_info
// -----------------------------------------------------------------------------

export const projectInfoParamsSchema = projectParamsSchema;

export const projectInfoResultSchema = t.object({
  id: t.integer(),
  title: t.string(),
  public: t.boolean(),
  packages: t.array(t.string()),
  createdAt: t.datetime(),
  activeTasks: t.array(
    t.object({
      id: t.integer(),
      title: t.string(),
      package: t.string(),
      priority: prioritySchema,
      complexity: t.integer(),
    }),
  ),
  character: t.optional(
    t.object({
      xp: t.integer(),
      balance: t.integer(),
      owner: t.boolean(),
    }),
  ),
});
