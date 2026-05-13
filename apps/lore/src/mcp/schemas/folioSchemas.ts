import { t } from "alepha";

/**
 * Lightweight folio reference returned by list/search tools.
 */
export const folioRefSchema = t.object({
  id: t.uuid(),
  shortId: t.integer(),
  title: t.string(),
  tags: t.array(t.string()),
  updatedAt: t.string(),
});

/**
 * Full folio payload returned by get/create/update tools.
 */
export const folioFullSchema = t.object({
  id: t.uuid(),
  shortId: t.integer(),
  title: t.string(),
  tags: t.array(t.string()),
  content: t.string(),
  createdAt: t.string(),
  updatedAt: t.string(),
});

/**
 * Reference param accepting either the global UUID `id` or the per-campaign
 * 1-based `shortId` (with `campaign` / `campaign_name` for disambiguation).
 */
export const folioRefParamsSchema = t.object({
  id: t.optional(
    t.uuid({
      description:
        "Global folio UUID (stable across sessions). Mutually exclusive with shortId.",
    }),
  ),
  shortId: t.optional(
    t.integer({
      description:
        "Per-campaign 1-based shortId ('#12'). Requires `campaign` or `campaign_name`.",
    }),
  ),
  campaign: t.optional(
    t.integer({
      description: "Campaign ID — required when using `shortId`.",
    }),
  ),
  campaign_name: t.optional(
    t.string({
      description:
        "Campaign name (case-insensitive) — required when using `shortId` if `campaign` not provided.",
    }),
  ),
});
