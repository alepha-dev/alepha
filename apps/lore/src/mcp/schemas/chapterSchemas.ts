import { z } from "alepha";
import { campaignParamsSchema } from "./commonSchemas.ts";

// -----------------------------------------------------------------------------
// chapter_list
// -----------------------------------------------------------------------------

export const chapterListParamsSchema = campaignParamsSchema;

export const chapterListResultSchema = z.object({
  chapters: z.array(
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
// chapter_start
// -----------------------------------------------------------------------------

export const chapterStartParamsSchema = campaignParamsSchema.extend({
  title: z
    .string()
    .describe("Chapter title (optional, defaults to 'Chapter N' if omitted)")
    .optional(),
  description: z.string().describe("Chapter description").optional(),
});

export const chapterStartResultSchema = z.object({
  id: z.integer(),
  number: z.integer(),
  title: z.string(),
  createdAt: z.datetime(),
});

// -----------------------------------------------------------------------------
// chapter_close
// -----------------------------------------------------------------------------

export const chapterCloseParamsSchema = z.object({
  id: z
    .integer()
    .describe("Global chapter ID. Mutually exclusive with `number`.")
    .optional(),
  number: z
    .integer()
    .describe(
      "Per-campaign chapter number ('Chapter 3'). Requires `campaign` or `campaign_name`.",
    )
    .optional(),
  campaign: z
    .integer()
    .describe("Campaign ID — required when using `number`.")
    .optional(),
  campaign_name: z
    .string()
    .describe("Campaign name (case-insensitive) — alternative to `campaign`.")
    .optional(),
  title: z
    .string()
    .describe("New title for the chapter (optional, keeps current if omitted)")
    .optional(),
});

export const chapterCloseResultSchema = z.object({
  id: z.integer(),
  number: z.integer(),
  title: z.string(),
  closedAt: z.datetime(),
});

// -----------------------------------------------------------------------------
// chapter_changelog
// -----------------------------------------------------------------------------

export const chapterChangelogParamsSchema = z.object({
  id: z
    .integer()
    .describe("Global chapter ID. Mutually exclusive with `number`.")
    .optional(),
  number: z
    .integer()
    .describe(
      "Per-campaign chapter number ('Chapter 3'). Requires `campaign` or `campaign_name`.",
    )
    .optional(),
  campaign: z
    .integer()
    .describe("Campaign ID — required when using `number`.")
    .optional(),
  campaign_name: z
    .string()
    .describe("Campaign name (case-insensitive) — alternative to `campaign`.")
    .optional(),
});

export const chapterChangelogResultSchema = z.object({
  markdown: z.string(),
  stats: z.object({
    questCount: z.integer(),
    zoneCount: z.integer(),
    contributorCount: z.integer(),
  }),
});
