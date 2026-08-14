import { type Infer, z } from "alepha";

/**
 * A folio attachment as the API returns it: the `folio_blobs` row joined
 * with its framework `files` row (size, mimeType, checksum, originalName).
 *
 * Lives in its own file rather than inside `BlobController` because two
 * surfaces now serialize it — `BlobController.listBlobs` and the
 * `metadata.blobs` that `FolioController.getByShortId?withBlobs=true`
 * attaches — and a second copy is how the two stop agreeing.
 */
export const hydratedBlobSchema = z.object({
  id: z.uuid(),
  shortId: z.integer(),
  projectId: z.integer(),
  folioId: z.uuid(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  size: z.number(),
  mimeType: z.string(),
  sha256: z.string().optional(),
  originalName: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export type HydratedBlob = Infer<typeof hydratedBlobSchema>;
