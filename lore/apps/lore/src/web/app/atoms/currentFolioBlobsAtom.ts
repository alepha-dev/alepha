import { $atom, z } from "alepha";

import { hydratedBlobSchema } from "@/api/schemas/hydratedBlobSchema.ts";

/**
 * The attachments of the folio currently open — what
 * `BlobController.listBlobs` returns for its `folioId`.
 *
 * Folio-scoped rather than project-scoped since attachments stopped being
 * rows in the folio tree: an attachment belongs to exactly one folio, so
 * "every blob in the project" is no longer a set anything renders. Filled
 * by the `projectFoliosFolio` route loader alongside `currentFolioAtom`
 * — from the folio's own `metadata.blobs` rather than a `listBlobs` call
 * of its own, see that loader — and cleared with it. `FolioAttachmentsTab`
 * refreshes it through `listBlobs` after an upload or a delete, which is
 * why it carries the endpoint's full shape rather than the subset the
 * tree used to render.
 */
export const currentFolioBlobsAtom = $atom({
  name: "lor.folio.blobs",
  schema: z.array(hydratedBlobSchema),
  default: [],
});
