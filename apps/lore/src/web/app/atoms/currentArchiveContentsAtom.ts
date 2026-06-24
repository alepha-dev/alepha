import { $atom, z } from "alepha";

/**
 * Pre-fetched contents of the current Archive directory — populated by
 * the `campaignFolios` route loader so the page renders with data
 * already in hand (no useEffect-on-mount → no "Loading…" flash on
 * first navigation).
 *
 * `undefined` means "not loaded yet" (initial state) or "we're on a
 * non-archive route". Cleared on `onLeave`.
 *
 * Schema mirrors `DirectoryController.listContents` response. Kept
 * loose (optional fields) so the atom doesn't break when a future
 * field is added to the controller.
 */
const entrySchema = z.object({
  kind: z.enum(["directory", "folio", "blob"]),
  id: z.string(),
  shortId: z.integer(),
  name: z.string(),
  updatedAt: z.string(),
  tags: z.array(z.string()).optional(),
  protected: z.boolean().optional(),
  pinned: z.boolean().optional(),
  summary: z.string().optional(),
  size: z.number().optional(),
  mimeType: z.string().optional(),
});

export const currentArchiveContentsAtom = $atom({
  name: "lore.archive.currentContents",
  description: "Pre-fetched Archive directory contents for the current route.",
  schema: z
    .object({
      directory: z
        .object({
          id: z.string(),
          shortId: z.integer(),
          name: z.string(),
          parentId: z.string().optional(),
        })
        .optional(),
      breadcrumb: z.array(
        z.object({
          id: z.string(),
          shortId: z.integer(),
          name: z.string(),
        }),
      ),
      entries: z.array(entrySchema),
    })
    .optional(),
  default: undefined,
});
