import { z } from "alepha";

import { projectParamsSchema } from "./projectParamsSchema.ts";

// -----------------------------------------------------------------------------
// milestone_list
// -----------------------------------------------------------------------------

export const milestoneListParamsSchema = projectParamsSchema;

export const milestoneListResultSchema = z.object({
  milestones: z.array(
    z.object({
      id: z.integer(),
      number: z.integer(),
      title: z.string(),
      description: z.string(),
      questCount: z.integer(),
      closedAt: z.datetime().optional(),
      createdAt: z.datetime(),
    }),
  ),
});

// -----------------------------------------------------------------------------
// milestone_start
// -----------------------------------------------------------------------------

export const milestoneStartParamsSchema = projectParamsSchema.extend({
  title: z
    .string()
    .describe(
      "Milestone title (optional, defaults to 'Milestone N' if omitted)",
    )
    .optional(),
  description: z.string().describe("Milestone description").optional(),
});

export const milestoneStartResultSchema = z.object({
  id: z.integer(),
  number: z.integer(),
  title: z.string(),
  createdAt: z.datetime(),
});

// -----------------------------------------------------------------------------
// milestone_close
// -----------------------------------------------------------------------------

export const milestoneCloseParamsSchema = z.object({
  id: z
    .integer()
    .describe("Global milestone ID. Mutually exclusive with `number`.")
    .optional(),
  number: z
    .integer()
    .describe(
      "Per-project milestone number ('Milestone 3'). Requires `project` or `project_name`.",
    )
    .optional(),
  project: z
    .integer()
    .describe("Project ID — required when using `number`.")
    .optional(),
  project_name: z
    .string()
    .describe("Project name (case-insensitive) — alternative to `project`.")
    .optional(),
  title: z
    .string()
    .describe(
      "New title for the milestone (optional, keeps current if omitted)",
    )
    .optional(),
});

export const milestoneCloseResultSchema = z.object({
  id: z.integer(),
  number: z.integer(),
  title: z.string(),
  closedAt: z.datetime(),
});

// -----------------------------------------------------------------------------
// milestone_changelog
// -----------------------------------------------------------------------------

export const milestoneChangelogParamsSchema = z.object({
  id: z
    .integer()
    .describe("Global milestone ID. Mutually exclusive with `number`.")
    .optional(),
  number: z
    .integer()
    .describe(
      "Per-project milestone number ('Milestone 3'). Requires `project` or `project_name`.",
    )
    .optional(),
  project: z
    .integer()
    .describe("Project ID — required when using `number`.")
    .optional(),
  project_name: z
    .string()
    .describe("Project name (case-insensitive) — alternative to `project`.")
    .optional(),
});

export const milestoneChangelogResultSchema = z.object({
  markdown: z.string(),
  stats: z.object({
    questCount: z.integer(),
    areaCount: z.integer(),
    contributorCount: z.integer(),
  }),
});
