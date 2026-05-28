import { type Static, t } from "alepha";
import { folios } from "../entities/folios.ts";

/**
 * Resolved outbound + inbound `[[wiki-link]]` refs for a folio.
 */
/**
 * Per-ref directory ancestor chain (root → … → direct parent) for a folio
 * referenced from another folio. Used by the backlinks panel to display
 * the full path (e.g. `specs/apps/admin`) rather than the bare folio
 * title, which is often ambiguous once paths are in use. Quest refs and
 * folios living at campaign root come back without `path`.
 */
const folioRefPathSchema = t.array(
  t.object({
    shortId: t.integer(),
    name: t.string(),
  }),
);

export const folioLinksSchema = t.object({
  outbound: t.array(
    t.object({
      kind: t.enum(["folio", "quest", "blob"]),
      shortId: t.integer(),
      // For folios and quests this is the entity title. For blobs it's
      // the Archive display name (e.g. "diagram.png").
      title: t.string(),
      path: t.optional(folioRefPathSchema),
    }),
  ),
  // Inbound is always folio→folio (only folios contain `[[...]]`).
  inbound: t.array(
    t.object({
      kind: t.enum(["folio"]),
      shortId: t.integer(),
      title: t.string(),
      path: t.optional(folioRefPathSchema),
    }),
  ),
});

/**
 * Server-computed virtual fields attached to a folio resource. Matches
 * the `QuestResource.metadata` convention — anything derived per-request
 * (not stored on the row) lives here, behind a `metadata` namespace so
 * future additions don't collide with entity columns.
 *
 * `links` is opt-in: only populated when the caller passes
 * `withLinks=true` (e.g. the folio-view route loader). Other endpoints
 * return `metadata: {}`.
 */
/**
 * Directory ancestor chain (root → … → direct parent) for a folio.
 * Same shape archive directories carry on `listContents`. Empty
 * array when the folio lives at the campaign root.
 */
export const folioPathSchema = t.array(
  t.object({
    shortId: t.integer(),
    name: t.string(),
  }),
);

export const folioMetadataSchema = t.object({
  links: t.optional(folioLinksSchema),
  path: t.optional(folioPathSchema),
});

/**
 * Folio entity + server-computed `metadata`. Resource is what the API
 * exposes; the bare entity (`folios.schema`) stays the canonical DB
 * shape. `metadata` is optional because only some endpoints compute it
 * (e.g. `getByShortId?withLinks=true`); `list`/`get`/`create`/`update`
 * return the bare entity.
 */
export const folioResourceSchema = t.extend(folios.schema, {
  metadata: t.optional(folioMetadataSchema),
});

export type FolioLinks = Static<typeof folioLinksSchema>;
export type FolioPath = Static<typeof folioPathSchema>;
export type FolioMetadata = Static<typeof folioMetadataSchema>;
export type FolioResource = Static<typeof folioResourceSchema>;
