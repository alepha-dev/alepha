import { $atom, z } from "alepha";

import { hydratedFolioAttachmentSchema } from "@/api/schemas/hydratedFolioAttachmentSchema.ts";

/**
 * The attachments of the folio currently open — what
 * `FolioAttachmentController.listAttachments` returns for its `folioId`.
 *
 * Folio-scoped rather than project-scoped since attachments stopped being
 * rows in the folio tree: an attachment belongs to exactly one folio, so
 * "every attachment in the project" is no longer a set anything renders. Filled
 * by the `projectFoliosFolio` route loader — from the folio's own
 * `metadata.attachments` rather than a `listAttachments` call of its own, see that
 * loader — and cleared by the `projectFolios` loader. `FolioAttachmentsTab`
 * refreshes it through `listAttachments` after an upload or a delete, which is
 * why it carries the endpoint's full shape rather than the subset the
 * tree used to render.
 */
export const currentFolioAttachmentsAtom = $atom({
  name: "lor.folio.attachments",
  schema: z.array(hydratedFolioAttachmentSchema),
  default: [],
});
