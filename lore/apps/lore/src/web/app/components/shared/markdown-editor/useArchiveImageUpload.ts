import { useClient } from "alepha/react";
import { useCallback } from "react";
import type { BlobController } from "@/api/controllers/BlobController.ts";

// Mirrors `ARCHIVE_BLOB_BUCKET_NAME` (ArchiveBlobService) — not imported
// so the browser bundle doesn't pull the server-side service module.
const ARCHIVE_BLOB_BUCKET = "archive-blobs";

/**
 * Image upload handler for folio markdown: two-step Archive upload
 * (framework file bytes, then blob registration on the campaign) — the
 * same flow as `ArchiveBrowser`. The image lands in the campaign Archive
 * (campaign root) where it is member-readable and manageable, and the
 * editor embeds `/api/files/<fileId>`.
 *
 * Returns `undefined` when disabled — protected folios must not upload
 * plaintext bytes next to encrypted content, and the editor hides its
 * image button when no handler is provided.
 */
export const useArchiveImageUpload = (
  campaignId: number | undefined,
  enabled: boolean,
): ((file: File) => Promise<string>) | undefined => {
  const blobApi = useClient<BlobController>();

  const handler = useCallback(
    async (file: File) => {
      if (campaignId === undefined) {
        throw new Error("No campaign in scope for image upload");
      }
      const form = new FormData();
      form.append("file", file);
      const url = `/api/files?bucket=${encodeURIComponent(ARCHIVE_BLOB_BUCKET)}`;
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
        params: { campaignId },
        body: {
          fileId: uploadedJson.id,
          name: file.name,
        },
      });
      return `/api/files/${uploadedJson.id}`;
    },
    [blobApi, campaignId],
  );

  return enabled && campaignId !== undefined ? handler : undefined;
};
