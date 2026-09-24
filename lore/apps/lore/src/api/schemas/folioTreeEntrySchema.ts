import type { Infer } from "alepha";

import { folios } from "../entities/folios.ts";

/**
 * One folio as the tree, the router's seed and the pickers read it: every
 * column but the heavy ones (#Q2510).
 *
 * `content` is present only on a pinned, unprotected folio, the one case a
 * reader of the list needs it (the pinned-budget bar sums those bodies).
 * Everything else is metadata, so a project's whole list costs less than
 * the capped page of whole rows it replaces.
 */
export const folioTreeEntrySchema = folios.schema
  .pick({
    id: true,
    shortId: true,
    createdAt: true,
    updatedAt: true,
    projectId: true,
    title: true,
    protected: true,
    tags: true,
    pinned: true,
    directoryId: true,
    epicId: true,
    summary: true,
  })
  .extend({ content: folios.schema.shape.content.optional() });

export type FolioTreeEntry = Infer<typeof folioTreeEntrySchema>;
