import { $atom, t } from "alepha";

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
const entrySchema = t.object({
  kind: t.enum(["directory", "folio", "blob"]),
  id: t.string(),
  shortId: t.integer(),
  name: t.string(),
  updatedAt: t.string(),
  tags: t.optional(t.array(t.string())),
  protected: t.optional(t.boolean()),
  pinned: t.optional(t.boolean()),
  summary: t.optional(t.string()),
  size: t.optional(t.number()),
  mimeType: t.optional(t.string()),
});

export const currentArchiveContentsAtom = $atom({
  name: "lore.archive.currentContents",
  description: "Pre-fetched Archive directory contents for the current route.",
  schema: t.optional(
    t.object({
      directory: t.optional(
        t.object({
          id: t.string(),
          shortId: t.integer(),
          name: t.string(),
          parentId: t.optional(t.string()),
        }),
      ),
      breadcrumb: t.array(
        t.object({
          id: t.string(),
          shortId: t.integer(),
          name: t.string(),
        }),
      ),
      entries: t.array(entrySchema),
    }),
  ),
  default: undefined,
});
