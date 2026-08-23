import { z } from "alepha";

import { linkSourceKindSchema } from "../../api/schemas/linkSourceKindSchema.ts";
import { linkTargetKindSchema } from "../../api/schemas/linkTargetKindSchema.ts";
import { epicStatusSchema } from "./commonSchemas.ts";

/**
 * The epic a folio is filed under. Same shape as the `epic` on quest rows
 * (`EpicRefService`): `number` is how an agent addresses the epic, and
 * `status` is what tells a planned epic's folios from released ones, since
 * no folio list is gated over MCP.
 */
export const folioEpicRefSchema = z.object({
  number: z.integer(),
  title: z.string(),
  status: epicStatusSchema,
});

/**
 * Lightweight folio reference returned by list/search tools.
 */
export const folioRefSchema = z.object({
  id: z.uuid(),
  shortId: z.integer(),
  title: z.string(),
  summary: z.string().optional(),
  updatedAt: z.string(),
  epic: folioEpicRefSchema.optional(),
});

/**
 * Wiki-link ref returned alongside a folio. `shortId` is the per-project
 * `#N` identifier — agents follow up via `folio_get` or `quest_get` +
 * `shortId` depending on `kind`. For `blob` refs the `title` is the
 * blob's display name (e.g. `diagram.png`) and the bytes are served at
 * `/api/files/<uuid>`; there is no MCP-side fetch tool for them.
 */
const folioLinkRefSchema = z.object({
  kind: linkTargetKindSchema,
  shortId: z.integer(),
  title: z.string(),
});

/**
 * Same as `folioLinkRefSchema` but restricted to `folio` — inbound
 * links can only come from other folios (only folios contain wiki-link
 * content).
 */
const folioInboundLinkRefSchema = z.object({
  kind: linkSourceKindSchema,
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
  summary: z.string().optional(),
  content: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /**
   * The epic this folio is filed under, absent when it has none. Set with
   * `epic_number` on `folio_create` / `folio_update`.
   */
  epic: folioEpicRefSchema.optional(),
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
 * Reference param accepting either the global UUID `id` or the per-project
 * 1-based `shortId` (with `project` / `project_name` for disambiguation).
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
      "Per-project 1-based shortId ('#12'). Requires `project` or `project_name`.",
    )
    .optional(),
  project: z
    .integer()
    .describe("Project ID — required when using `shortId`.")
    .optional(),
  project_name: z
    .string()
    .describe(
      "Project name (case-insensitive) — required when using `shortId` if `project` not provided.",
    )
    .optional(),
});
