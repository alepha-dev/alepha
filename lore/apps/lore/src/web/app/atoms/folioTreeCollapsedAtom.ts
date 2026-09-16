import { $atom, z } from "alepha";

/**
 * Which folio directories are collapsed, and for which project.
 *
 * ⚠️ An atom rather than state inside `useFolioTreeModel`, because the tree
 * does not live forever. It survives every navigation INSIDE `/folios` since
 * #Q2349 hoisted it into `FolioWorkspaceShell`, but leaving `/folios` (to the
 * quests, say) unmounts the layout, and coming back mounts a fresh tree.
 *
 * Before that hoist the step from `/folios` to a folio remounted it too, and
 * the hook's `initializedRef` guard, which survives re-renders but not a
 * remount, let the one-time seed run again and re-collapse every directory
 * except the opened folio's own ancestors (feedback #2100, which is feedback
 * #14 arriving through a door its guard was never watching).
 *
 * An atom survives a remount by construction, which is the only property that
 * actually fixes it. `folioTreeSeedAtom` and `questLogCollapsedAtom` are the
 * same idea, here and elsewhere.
 *
 * `projectId` is carried WITH the set, not assumed: it is what makes the seed
 * run once per PROJECT rather than once per mount, which is what "one-time"
 * was always trying to mean. A stored set belonging to another project reads
 * as "not seeded yet", so switching project seeds afresh instead of applying
 * one project's collapse map to another's directories.
 *
 * An array rather than a `Set` because `$atom` schemas are validated, and a
 * `Set` is not something zod can describe. The hook converts at the edges.
 */
export const folioTreeCollapsedAtom = $atom({
  name: "lor.folio.tree.collapsed",
  schema: z
    .object({
      projectId: z.integer(),
      collapsed: z.array(z.string()),
    })
    .optional(),
});
