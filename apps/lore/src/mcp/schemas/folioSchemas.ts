import { z } from "alepha";

/**
 * Lightweight folio reference returned by list/search tools.
 */
export const folioRefSchema = z.object({
  id: z.uuid(),
  shortId: z.integer(),
  title: z.string(),
  tags: z.array(z.string()),
  summary: z.string().optional(),
  updatedAt: z.string(),
});

/**
 * Wiki-link ref returned alongside a folio. `shortId` is the per-campaign
 * `#N` identifier — agents follow up via `folio_get` + `shortId` (or
 * `quest_get` / `blob_get` depending on `kind`). For `blob` refs the
 * `title` is the Archive display name (e.g. `diagram.png`), and the
 * blob's bytes live at `/api/files/<uuid>` (no MCP-side fetch tool yet).
 */
const folioLinkRefSchema = z.object({
  kind: z.enum(["folio", "quest", "blob"]),
  shortId: z.integer(),
  title: z.string(),
});

/**
 * Same as `folioLinkRefSchema` but restricted to `folio` — inbound
 * links can only come from other folios (only folios contain wiki-link
 * content).
 */
const folioInboundLinkRefSchema = z.object({
  kind: z.enum(["folio"]),
  shortId: z.integer(),
  title: z.string(),
});

/**
 * Full folio payload returned by get/create/update tools.
 */
export const folioFullSchema = z.object({
  id: z.uuid(),
  shortId: z.integer(),
  title: z.string(),
  tags: z.array(z.string()),
  summary: z.string().optional(),
  content: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /**
   * Wiki-style cross-folio references resolved at save time. `outbound`
   * are folios this one points to via `[[...]]`; `inbound` are folios
   * that point AT this one. Present on `folio_get` only — `folio_create`
   * and `folio_update` omit it (the post-write sync runs but we don't
   * round-trip to resolve display refs in those code paths).
   */
  links: z
    .object({
      outbound: z.array(folioLinkRefSchema),
      inbound: z.array(folioInboundLinkRefSchema),
    })
    .optional(),
});

/**
 * Reference param accepting either the global UUID `id` or the per-campaign
 * 1-based `shortId` (with `campaign` / `campaign_name` for disambiguation).
 */
export const folioRefParamsSchema = z.object({
  id: z
    .uuid()
    .describe(
      "Global folio UUID (stable across sessions). Mutually exclusive with shortId.",
    )
    .optional(),
  shortId: z
    .integer()
    .describe(
      "Per-campaign 1-based shortId ('#12'). Requires `campaign` or `campaign_name`.",
    )
    .optional(),
  campaign: z
    .integer()
    .describe("Campaign ID — required when using `shortId`.")
    .optional(),
  campaign_name: z
    .string()
    .describe(
      "Campaign name (case-insensitive) — required when using `shortId` if `campaign` not provided.",
    )
    .optional(),
});
