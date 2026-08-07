import { $atom, z } from "alepha";

/**
 * Carries the id of a just-created folio through the `/folios/new` →
 * `/folios/:shortId` navigation, so the tree pane can drop it straight into
 * rename mode on the other side.
 *
 * `useFolioTreeModel`'s `renamingId` is ordinary component state, which is
 * enough for a rename started from the context menu (no navigation
 * involved) — but `createFolio` immediately `router.push`es to the new
 * folio's real URL, and that specific navigation crosses a PAGE-COMPONENT
 * boundary: `projectFoliosNew`'s lazy component is `FolioCreatePage`
 * (`<FolioCreatePage><FolioWorkspace/></FolioCreatePage>`), while
 * `projectFoliosFolio`'s is `FolioWorkspace` directly. Different component
 * types at the same tree position force React to unmount and remount
 * everything below, including the tree pane and its `renamingId` state —
 * unlike an ordinary folio-to-folio navigation (same route, param-only),
 * which does not remount (see `FolioWorkspace.tsx`'s doc). Every OTHER
 * "New folio" click (from an existing folio's page, or the folios index)
 * stays on `projectFoliosFolio` and needs no help from this atom.
 *
 * `useFolioTreeModel` reads this once as its `renamingId` state's
 * initializer and clears it immediately after, so it never leaks into a
 * later, unrelated mount.
 */
export const pendingFolioTreeRenameAtom = $atom({
  name: "lor.folio.tree.pendingRename",
  schema: z.string().optional(),
  default: undefined,
});
