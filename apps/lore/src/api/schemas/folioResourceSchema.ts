import { type Infer, z } from "alepha";

import { folios } from "../entities/folios.ts";
import { hydratedBlobSchema } from "./hydratedBlobSchema.ts";
import { linkSourceKindSchema } from "./linkSourceKindSchema.ts";
import { linkTargetKindSchema } from "./linkTargetKindSchema.ts";

/**
 * Resolved outbound + inbound `[[wiki-link]]` refs for a folio.
 */
/**
 * Per-ref directory ancestor chain (root → … → direct parent) for a folio
 * referenced from another folio. Used by the backlinks panel to display
 * the full path (e.g. `specs/apps/admin`) rather than the bare folio
 * title, which is often ambiguous once paths are in use. Quest refs and
 * folios living at project root come back without `path`.
 */
const folioRefPathSchema = z.array(
  z.object({
    shortId: z.integer(),
    name: z.string(),
  }),
);

export const folioLinksSchema = z.object({
  outbound: z.array(
    z.object({
      kind: linkTargetKindSchema,
      // The number an entity is addressed by: a folio's / quest's
      // `shortId`, an epic's `number`. One field across every kind so the
      // Links tab renders one row shape.
      shortId: z.integer(),
      // For elements this is the entity title. For blobs it's the blob's
      // display name (e.g. "diagram.png").
      title: z.string(),
      path: folioRefPathSchema.optional(),
    }),
  ),
  // Inbound can come from any element that carries a body — a folio, a
  // quest, an epic (and comments once they exist). `blob` is absent by
  // construction: it has bytes, not content, so nothing inside it links.
  inbound: z.array(
    z.object({
      kind: linkSourceKindSchema,
      shortId: z.integer(),
      title: z.string(),
      path: folioRefPathSchema.optional(),
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
 * Same shape folio directories carry on `listContents`. Empty
 * array when the folio lives at the project root.
 */
export const folioPathSchema = z.array(
  z.object({
    shortId: z.integer(),
    name: z.string(),
  }),
);

export const folioMetadataSchema = z.object({
  links: folioLinksSchema.optional(),
  path: folioPathSchema.optional(),
  /**
   * The folio's attachments, same shape `BlobController.listBlobs`
   * returns. Opt-in via `withBlobs=true` so the workspace gets them in
   * the call that fetches the folio instead of a second round-trip it
   * could only start once the folio's `id` was known.
   */
  blobs: z.array(hydratedBlobSchema).optional(),
});

/**
 * Folio entity + server-computed `metadata`. Resource is what the API
 * exposes; the bare entity (`folios.schema`) stays the canonical DB
 * shape. `metadata` is optional because only some endpoints compute it
 * (e.g. `getByShortId?withLinks=true`); `list`/`get`/`create`/`update`
 * return the bare entity.
 */
export const folioResourceSchema = folios.schema.extend({
  metadata: folioMetadataSchema.optional(),
});

export type FolioLinks = Infer<typeof folioLinksSchema>;
export type FolioPath = Infer<typeof folioPathSchema>;
export type FolioMetadata = Infer<typeof folioMetadataSchema>;
export type FolioResource = Infer<typeof folioResourceSchema>;
