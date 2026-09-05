import { resizeImage } from "@alepha/ui/lib/resize-image";
import { AlephaError } from "alepha";
import { useClient } from "alepha/react";
import { useCallback } from "react";

import type { FolioAttachmentController } from "@/api/controllers/FolioAttachmentController.ts";

import { folioAssetPath } from "../../folios/folioAssetReference.ts";
import { FOLIO_IMAGE_MAX_WIDTH } from "../../folios/folioImageBounds.ts";

// Mirrors `FolioAttachmentService.BUCKET` — not imported
// so the browser bundle doesn't pull the server-side service module.
// Bucket value stays "archive-blobs" — see the note on
// `FOLIO_ATTACHMENT_BUCKET` in `FolioAttachmentService.ts`.
const FOLIO_ATTACHMENT_BUCKET = "archive-blobs";

/**
 * Image upload handler for folio markdown: two-step attachment upload —
 * framework file bytes, then registration as an attachment of `folioId`.
 *
 * Returns the **relative** `assets/<name>` path, not `/api/files/<uuid>`.
 * That is what makes an export a copy rather than a transform: the stored
 * markdown is the exported markdown, and an unzipped folio opens correctly
 * in any markdown viewer sitting next to its `assets/` folder. The reader
 * (`rewriteFolioWikiLinks`) and the editor's `imagePreviewHandler` are what
 * turn it back into a URL for display.
 *
 * The name comes from the server's response, not from `file.name` — the
 * two differ whenever the folio already had an attachment by that name and
 * `FolioAttachmentService` auto-suffixed it. Using the local name would write a
 * reference that resolves to nothing.
 *
 * Returns `undefined` when disabled — protected folios must not upload
 * plaintext bytes next to encrypted content, and the editor hides its
 * image button when no handler is provided.
 */
export const useFolioImageUpload = (
  projectId: number | undefined,
  folioId: string | undefined,
  enabled: boolean,
): ((file: File) => Promise<string>) | undefined => {
  const attachmentApi = useClient<FolioAttachmentController>();

  const handler = useCallback(
    async (original: File) => {
      if (projectId === undefined || folioId === undefined) {
        throw new AlephaError("No folio in scope for image upload");
      }
      // MDXEditor's paste handler calls this with `DataTransferItem
      // .getAsFile()`, which is typed `File | null`. It only ever reaches
      // here for items it has already confirmed are images, so a null is
      // not expected — but an unguarded one would surface as a confusing
      // `resizeImage` crash rather than a clear refusal.
      if (!original) {
        throw new AlephaError("Nothing to upload");
      }
      // Downscaled before the bytes leave the machine, exactly as the
      // Attachments panel does it. This path carries the toolbar's image
      // button AND paste — MDXEditor routes clipboard images straight
      // through here — so a screenshot pasted with ⌘V is the commonest
      // upload in the app and the one most worth shrinking: a Retina
      // capture is several megabytes of PNG rendered at document width.
      //
      // Best-effort by design: an SVG, a non-raster file, a browser
      // without `OffscreenCanvas`, or a re-encode that comes out larger
      // all return the input untouched.
      const file = await resizeImage(original, {
        maxWidth: FOLIO_IMAGE_MAX_WIDTH,
      });
      const form = new FormData();
      form.append("file", file);
      const url = `/api/files?bucket=${encodeURIComponent(FOLIO_ATTACHMENT_BUCKET)}`;
      const uploaded = await fetch(url, {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!uploaded.ok) {
        throw new AlephaError(`upload failed: ${uploaded.status}`);
      }
      const uploadedJson = (await uploaded.json()) as { id: string };
      const attachment = await attachmentApi.registerAttachment({
        params: { projectId },
        body: {
          fileId: uploadedJson.id,
          name: file.name,
          folioId,
        },
      });
      return folioAssetPath(attachment.name);
    },
    [attachmentApi, projectId, folioId],
  );

  return enabled && projectId !== undefined && folioId !== undefined
    ? handler
    : undefined;
};
