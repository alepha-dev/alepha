import { z } from "alepha";

import { projectParamsSchema } from "./projectParamsSchema.ts";

// -----------------------------------------------------------------------------
// release_list
// -----------------------------------------------------------------------------

export const releaseListParamsSchema = projectParamsSchema;

export const releaseListResultSchema = z.object({
  releases: z.array(
    z.object({
      id: z.integer(),
      number: z.integer(),
      tag: z.string().optional(),
      title: z.string(),
      description: z.string(),
      releasedAt: z.datetime().optional(),
      createdAt: z.datetime(),
    }),
  ),
});

// -----------------------------------------------------------------------------
// release_start
// -----------------------------------------------------------------------------

export const releaseStartParamsSchema = projectParamsSchema.extend({
  tag: z
    .string()
    .describe(
      "The release tag, e.g. `0.28.0` or `demo-1`. Unique per project, and the release's identity everywhere: it is the URL segment and the join key to the artifacts CI publishes. Letters, digits and interior dots, underscores or hyphens; case is preserved.",
    ),
  title: z
    .string()
    .describe("Display title. Defaults to the tag when omitted.")
    .optional(),
  description: z.string().describe("Release description").optional(),
});

export const releaseStartResultSchema = z.object({
  id: z.integer(),
  number: z.integer(),
  title: z.string(),
  createdAt: z.datetime(),
});

// -----------------------------------------------------------------------------
// release_publish
// -----------------------------------------------------------------------------

export const releasePublishParamsSchema = z.object({
  id: z
    .integer()
    .describe("Global release ID. Mutually exclusive with `number`.")
    .optional(),
  number: z
    .integer()
    .describe(
      "Per-project release number ('Release 3'). Requires `project` or `project_name`.",
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
    .describe("New title for the release (optional, keeps current if omitted)")
    .optional(),
});

export const releasePublishResultSchema = z.object({
  id: z.integer(),
  number: z.integer(),
  title: z.string(),
  releasedAt: z.datetime(),
});

// -----------------------------------------------------------------------------
// release_changelog
// -----------------------------------------------------------------------------

export const releaseChangelogParamsSchema = z.object({
  id: z
    .integer()
    .describe("Global release ID. Mutually exclusive with `number`.")
    .optional(),
  number: z
    .integer()
    .describe(
      "Per-project release number ('Release 3'). Requires `project` or `project_name`.",
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

export const releaseChangelogResultSchema = z.object({
  markdown: z.string(),
  stats: z.object({
    questCount: z.integer(),
    areaCount: z.integer(),
    contributorCount: z.integer(),
  }),
});
