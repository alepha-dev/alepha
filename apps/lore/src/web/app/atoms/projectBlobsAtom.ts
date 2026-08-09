import { $atom, z } from "alepha";

/**
 * Flat list of every uploaded file in the current project — what
 * `BlobController.listAllBlobs` returns.
 *
 * Sibling of `projectDirectoriesAtom` and `userFoliosAtom`, filled by the same
 * route loaders and for the same reason: the folio tree assembles all three
 * flat lists into one tree, so fetching blobs from inside the tree component
 * would miss the alepha auto-batch window the other two already share.
 */
export const projectBlobsAtom = $atom({
  name: "lor.project.blobs",
  schema: z.array(
    z.object({
      fileId: z.uuid(),
      shortId: z.integer(),
      name: z.string(),
      directoryId: z.uuid().optional(),
      updatedAt: z.string(),
    }),
  ),
  default: [],
});
