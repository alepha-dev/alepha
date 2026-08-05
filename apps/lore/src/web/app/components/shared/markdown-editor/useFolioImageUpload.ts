import { useClient } from "alepha/react";
import { useCallback } from "react";
import type { BlobController } from "@/api/controllers/BlobController.ts";

// Mirrors `FOLIO_BLOB_BUCKET_NAME` (FolioBlobService) — not imported
// so the browser bundle doesn't pull the server-side service module.
// Bucket value stays "archive-blobs" — see the note on
// `FOLIO_BLOB_BUCKET` in `FolioBlobService.ts`.
const FOLIO_BLOB_BUCKET = "archive-blobs";

/**
 * Image upload handler for folio markdown: two-step blob upload
 * (framework file bytes, then blob registration on the project) — the
 * same flow as `FolioBrowser`. The image lands at the project root of
 * the folio tree where it is member-readable and manageable, and the
 * editor embeds `/api/files/<fileId>`.
 *
 * Returns `undefined` when disabled — protected folios must not upload
 * plaintext bytes next to encrypted content, and the editor hides its
 * image button when no handler is provided.
 */
export const useFolioImageUpload = (
  projectId: number | undefined,
  enabled: boolean,
): ((file: File) => Promise<string>) | undefined => {
  const blobApi = useClient<BlobController>();

  const handler = useCallback(
    async (file: File) => {
      if (projectId === undefined) {
        throw new Error("No project in scope for image upload");
      }
      const form = new FormData();
      form.append("file", file);
      const url = `/api/files?bucket=${encodeURIComponent(FOLIO_BLOB_BUCKET)}`;
      const uploaded = await fetch(url, {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!uploaded.ok) {
        throw new Error(`upload failed: ${uploaded.status}`);
      }
      const uploadedJson = (await uploaded.json()) as { id: string };
      await blobApi.registerBlob({
        params: { projectId },
        body: {
          fileId: uploadedJson.id,
          name: file.name,
        },
      });
      return `/api/files/${uploadedJson.id}`;
    },
    [blobApi, projectId],
  );

  return enabled && projectId !== undefined ? handler : undefined;
};
