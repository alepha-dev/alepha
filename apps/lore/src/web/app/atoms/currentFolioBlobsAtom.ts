import { $atom, z } from "alepha";

/**
 * The attachments of the folio currently open — what
 * `BlobController.listBlobs` returns for its `folioId`.
 *
 * Folio-scoped rather than project-scoped since attachments stopped being
 * rows in the folio tree: an attachment belongs to exactly one folio, so
 * "every blob in the project" is no longer a set anything renders. Filled
 * by the `projectFoliosFolio` route loader alongside `currentFolioAtom`,
 * and cleared with it.
 */
export const currentFolioBlobsAtom = $atom({
  name: "lor.folio.blobs",
  schema: z.array(
    z.object({
      id: z.uuid(),
      shortId: z.integer(),
      name: z.string(),
      size: z.number(),
      mimeType: z.string(),
      updatedAt: z.string(),
    }),
  ),
  default: [],
});
