import { $atom, z } from "alepha";

/**
 * Which folio directories are collapsed, and for which project.
 *
 * ⚠️ An atom rather than state inside `useFolioTreeModel`, and the reason is
 * a remount the hook cannot see. `FoliosLayout` renders
 * `{name === "projectFolios" ? <FolioWorkspace empty /> : <NestedView />}` -
 * two different element positions of two different component types - so
 * walking from `/folios` to `/folios/:shortId` unmounts one and mounts the
 * other. The hook's `initializedRef` guard survives re-renders but not that,
 * so its one-time seed ran a second time and re-collapsed every directory
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
