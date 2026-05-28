import { t } from "alepha";

/**
 * Lightweight folio reference returned by list/search tools.
 */
export const folioRefSchema = t.object({
  id: t.uuid(),
  shortId: t.integer(),
  title: t.string(),
  tags: t.array(t.string()),
  summary: t.optional(t.string()),
  updatedAt: t.string(),
});

/**
 * Wiki-link ref returned alongside a folio. `shortId` is the per-campaign
 * `#N` identifier — agents follow up via `folio_get` + `shortId` (or
 * `quest_get` / `blob_get` depending on `kind`). For `blob` refs the
 * `title` is the Archive display name (e.g. `diagram.png`), and the
 * blob's bytes live at `/api/files/<uuid>` (no MCP-side fetch tool yet).
 */
const folioLinkRefSchema = t.object({
  kind: t.enum(["folio", "quest", "blob"]),
  shortId: t.integer(),
  title: t.string(),
});

/**
 * Same as `folioLinkRefSchema` but restricted to `folio` — inbound
 * links can only come from other folios (only folios contain wiki-link
 * content).
 */
const folioInboundLinkRefSchema = t.object({
  kind: t.enum(["folio"]),
  shortId: t.integer(),
  title: t.string(),
});

/**
 * Full folio payload returned by get/create/update tools.
 */
export const folioFullSchema = t.object({
  id: t.uuid(),
  shortId: t.integer(),
  title: t.string(),
  tags: t.array(t.string()),
  summary: t.optional(t.string()),
  content: t.string(),
  createdAt: t.string(),
  updatedAt: t.string(),
  /**
   * Wiki-style cross-folio references resolved at save time. `outbound`
   * are folios this one points to via `[[...]]`; `inbound` are folios
   * that point AT this one. Present on `folio_get` only — `folio_create`
   * and `folio_update` omit it (the post-write sync runs but we don't
   * round-trip to resolve display refs in those code paths).
   */
  links: t.optional(
    t.object({
      outbound: t.array(folioLinkRefSchema),
      inbound: t.array(folioInboundLinkRefSchema),
    }),
  ),
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
