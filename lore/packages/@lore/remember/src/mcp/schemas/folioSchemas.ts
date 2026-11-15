import {
  linkSourceKindSchema,
  linkTargetKindSchema,
  diagramWarningsShape,
  epicStatusSchema,
} from "@lore/core/schemas";
import { z } from "alepha";

/**
 * The epic a folio is filed under. Same shape as the `epic` on quest rows
 * (`EpicRefService`): `number` is how an agent addresses the epic, and
 * `status` is what tells a draft epic's folios from released ones, since
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
  /**
   * `text` (Markdown in `content`) or `table` (typed rows: read them with
   * the row tools).
   */
  type: z.enum(["text", "table", "calendar"]),
  summary: z.string().optional(),
  updatedAt: z.string(),
  epic: folioEpicRefSchema.optional(),
});

/**
 * Reference returned alongside a folio. `shortId` is the per-project number
 * the kind is addressed by, the one after the letter in `[[#F12]]`,
 * `[[#Q12]]`, `[[#E3]]`, `[[#P120]]`, `[[#R12]]`. Follow up via `folio_get`,
 * `quest_get`, `epic_get`, `feedback_get` or `release_get` depending on
 * `kind`.
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
/**
 * A table's column as an agent reads it: by name, a select with its labels.
 */
export const folioCompactColumnSchema = z.object({
  name: z.string(),
  type: z.string(),
  choices: z.array(z.string()).optional(),
  withTime: z.boolean().optional(),
});

/**
 * A table's row as an agent reads it: its number, its version, and its cells
 * keyed by column name (a select by its label, a reference by its code).
 */
export const folioCompactRowSchema = z.object({
  number: z.integer(),
  version: z.integer(),
  cells: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null()]),
  ),
});

export const folioFullSchema = z.object({
  id: z.uuid(),
  shortId: z.integer(),
  title: z.string(),
  summary: z.string().optional(),
  /**
   * `text`, or `table`: then `content` is empty and the folio is its
   * `columns` and `rows`.
   */
  type: z.enum(["text", "table", "calendar"]).optional(),
  content: z.string(),
  /**
   * A table's columns, its row count, and its first 50 rows; `truncated`
   * when there are more (read them with `folio_row_list`). `folio_get`
   * only.
   */
  columns: z.array(folioCompactColumnSchema).optional(),
  rowCount: z.integer().optional(),
  rows: z.array(folioCompactRowSchema).optional(),
  truncated: z.boolean().optional(),
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
  /**
   * Set by `folio_create` / `folio_update` only. `folio_get` never carries
   * it: nothing was written, so there is nothing to warn about.
   */
  ...diagramWarningsShape,
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
