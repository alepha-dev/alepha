import { z } from "alepha";

import { projectParamsSchema } from "./projectParamsSchema.ts";

/**
 * How every tool in this surface names a release.
 *
 * By TAG, never by number: an agent writes `0.28.0`, not `3`. Same reason the
 * URL is `/alepha/releases/0.28.0`. `number` stays on the entity as the stable
 * internal reference and the sort key; it is simply not how a release is
 * addressed.
 */
export const releaseRefSchema = z.object({
  tag: z
    .string()
    .describe(
      "The release's tag, e.g. `0.28.0` (see release_list). This is how a release is named everywhere in this surface.",
    ),
  project: z
    .integer()
    .describe("Project ID. Required if project_name is not provided.")
    .optional(),
  project_name: z
    .string()
    .describe("Project name (case-insensitive). Alternative to `project`.")
    .optional(),
});

const releaseRowSchema = z.object({
  number: z
    .integer()
    .describe("Per-project number. The sort key, not the identity."),
  tag: z.string().optional(),
  title: z.string(),
  description: z.string(),
  targetDate: z
    .datetime()
    .describe("When it is MEANT to ship. An estimate; nothing enforces it.")
    .optional(),
  releasedAt: z
    .datetime()
    .describe("Absent while the release is open. Present means published.")
    .optional(),
  progress: z.object({
    completed: z.integer(),
    inProgress: z.integer(),
    shelved: z.integer(),
    total: z.integer(),
  }),
  createdAt: z.datetime(),
});

// -----------------------------------------------------------------------------
// release_list
// -----------------------------------------------------------------------------

export const releaseListParamsSchema = projectParamsSchema;

export const releaseListResultSchema = z.object({
  releases: z.array(releaseRowSchema),
});

// -----------------------------------------------------------------------------
// release_get
// -----------------------------------------------------------------------------

export const releaseGetParamsSchema = releaseRefSchema;

export const releaseGetResultSchema = releaseRowSchema.extend({
  epics: z.array(
    z.object({
      number: z.integer(),
      title: z.string(),
      status: z.string(),
      completed: z
        .integer()
        .describe(
          "Counted over the epic's quests THAT ARE IN THIS RELEASE, not its whole quest set: an epic may carry a quest that names another release.",
        ),
      total: z.integer(),
    }),
  ),
  looseQuests: z
    .array(
      z.object({
        shortId: z.integer(),
        title: z.string(),
        area: z.string().optional(),
        priority: z.string(),
        completedAt: z.datetime().optional(),
      }),
    )
    .describe(
      "Attached directly rather than through an epic: the hotfix, the doc pass, the one chore.",
    ),
});

// -----------------------------------------------------------------------------
// release_create
// -----------------------------------------------------------------------------

export const releaseCreateParamsSchema = projectParamsSchema.extend({
  tag: z
    .string()
    .describe(
      "The release tag, e.g. `0.28.0` or `demo-1`. Unique per project, and the release's identity everywhere: it is the URL segment and the join key to the artifacts CI publishes. Letters, digits and interior dots, underscores or hyphens; case is preserved, so `RC1` stays `RC1`.",
    ),
  title: z
    .string()
    .describe("Display title. Defaults to the tag when omitted.")
    .optional(),
  description: z.string().describe("Release description").optional(),
  targetDate: z
    .datetime()
    .describe(
      "When this release is meant to ship. An estimate: nothing enforces it and no job reads it.",
    )
    .optional(),
});

export const releaseCreateResultSchema = releaseRowSchema;

// -----------------------------------------------------------------------------
// release_update
// -----------------------------------------------------------------------------

export const releaseUpdateParamsSchema = releaseRefSchema.extend({
  new_tag: z
    .string()
    .describe(
      "Retag the release. ⚠️ The tag is the release's URL segment, so changing it BREAKS every link already shared to this release - there is no redirect and no tag history. The UI asks for confirmation before doing this; you have no dialog, so be sure it is what was asked for.",
    )
    .optional(),
  title: z.string().describe("New display title").optional(),
  description: z.string().describe("New description").optional(),
  targetDate: z
    .datetime()
    .describe("New target date. Pass an empty string to clear it.")
    .optional(),
});

export const releaseUpdateResultSchema = releaseRowSchema;

// -----------------------------------------------------------------------------
// release_publish / release_reopen
// -----------------------------------------------------------------------------

export const releasePublishParamsSchema = releaseRefSchema.extend({
  title: z
    .string()
    .describe(
      "Final title for the release (optional, keeps current if omitted)",
    )
    .optional(),
});

export const releasePublishResultSchema = releaseRowSchema;

export const releaseReopenParamsSchema = releaseRefSchema;

export const releaseReopenResultSchema = releaseRowSchema;

// -----------------------------------------------------------------------------
// release_attach / release_detach
// -----------------------------------------------------------------------------

export const releaseAttachParamsSchema = releaseRefSchema.extend({
  epic_number: z
    .integer()
    .describe(
      "Per-project number of an epic to put in this release (see epic_list). An epic belongs to at most one release: attaching it here takes it out of whichever release it was in.",
    )
    .optional(),
  quest_shortId: z
    .integer()
    .describe(
      "Per-project shortId of a quest to put in this release (the `#42` in the UI). For loose work that deserves no epic.",
    )
    .optional(),
});

export const releaseAttachResultSchema = z.object({
  ok: z.boolean(),
  tag: z.string(),
});

export const releaseDetachParamsSchema = releaseAttachParamsSchema;

export const releaseDetachResultSchema = releaseAttachResultSchema;

// -----------------------------------------------------------------------------
// release_changelog
// -----------------------------------------------------------------------------

export const releaseChangelogParamsSchema = releaseRefSchema;

export const releaseChangelogResultSchema = z.object({
  markdown: z.string(),
  frozen: z
    .boolean()
    .describe(
      "True once the release is published: the markdown is a snapshot of what it shipped and does not move again.",
    ),
  stats: z.object({
    questCount: z.integer(),
    areaCount: z.integer(),
    contributorCount: z.integer(),
  }),
});

// -----------------------------------------------------------------------------
// release_delete
// -----------------------------------------------------------------------------

export const releaseDeleteParamsSchema = releaseRefSchema;

export const releaseDeleteResultSchema = z.object({ ok: z.boolean() });
