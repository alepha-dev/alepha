import { t } from "alepha";
import { campaignParamsSchema } from "./commonSchemas.ts";

// -----------------------------------------------------------------------------
// chapter_list
// -----------------------------------------------------------------------------

export const chapterListParamsSchema = campaignParamsSchema;

export const chapterListResultSchema = t.object({
  chapters: t.array(
    t.object({
      id: t.integer(),
      number: t.integer(),
      title: t.string(),
      description: t.string(),
      questCount: t.integer(),
      closedAt: t.optional(t.datetime()),
      createdAt: t.datetime(),
    }),
  ),
});

// -----------------------------------------------------------------------------
// chapter_start
// -----------------------------------------------------------------------------

export const chapterStartParamsSchema = t.extend(campaignParamsSchema, {
  title: t.optional(
    t.string({
      description:
        "Chapter title (optional, defaults to 'Chapter N' if omitted)",
    }),
  ),
  description: t.optional(
    t.string({
      description: "Chapter description",
    }),
  ),
});

export const chapterStartResultSchema = t.object({
  id: t.integer(),
  number: t.integer(),
  title: t.string(),
  createdAt: t.datetime(),
});

// -----------------------------------------------------------------------------
// chapter_close
// -----------------------------------------------------------------------------

export const chapterCloseParamsSchema = t.object({
  id: t.optional(
    t.integer({
      description: "Global chapter ID. Mutually exclusive with `number`.",
    }),
  ),
  number: t.optional(
    t.integer({
      description:
        "Per-campaign chapter number ('Chapter 3'). Requires `campaign` or `campaign_name`.",
    }),
  ),
  campaign: t.optional(
    t.integer({
      description: "Campaign ID — required when using `number`.",
    }),
  ),
  campaign_name: t.optional(
    t.string({
      description:
        "Campaign name (case-insensitive) — alternative to `campaign`.",
    }),
  ),
  title: t.optional(
    t.string({
      description:
        "New title for the chapter (optional, keeps current if omitted)",
    }),
  ),
});

export const chapterCloseResultSchema = t.object({
  id: t.integer(),
  number: t.integer(),
  title: t.string(),
  closedAt: t.datetime(),
});

// -----------------------------------------------------------------------------
// chapter_changelog
// -----------------------------------------------------------------------------

export const chapterChangelogParamsSchema = t.object({
  id: t.optional(
    t.integer({
      description: "Global chapter ID. Mutually exclusive with `number`.",
    }),
  ),
  number: t.optional(
    t.integer({
      description:
        "Per-campaign chapter number ('Chapter 3'). Requires `campaign` or `campaign_name`.",
    }),
  ),
  campaign: t.optional(
    t.integer({
      description: "Campaign ID — required when using `number`.",
    }),
  ),
  campaign_name: t.optional(
    t.string({
      description:
        "Campaign name (case-insensitive) — alternative to `campaign`.",
    }),
  ),
});

export const chapterChangelogResultSchema = t.object({
  markdown: t.string(),
  stats: t.object({
    questCount: t.integer(),
    zoneCount: t.integer(),
    contributorCount: t.integer(),
  }),
});
