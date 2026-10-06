import { $atom, z } from "alepha";

/**
 * Which project `userFoliosAtom` + `projectDirectoriesAtom` currently
 * hold, and when they were filled. Written by `AppRouter.seedFolioTree`,
 * read by nothing else.
 *
 * It exists because every folio route loader used to re-fetch both lists
 * unconditionally, and the folio tree they feed is a pane that does not
 * even unmount between folios: opening ten folios in a row re-downloaded
 * the same hundred rows ten times. Worse, the `/folios` layout loader
 * fetches them too and layout loaders are NOT re-run on child navigation
 * — so entering `/folios/:shortId` from outside ran both loaders back to
 * back, in separate ticks (the router awaits each layer in turn), which
 * means the duplicate could not even be folded into the client's batch
 * window. It was two HTTP calls for one set of rows.
 *
 * A timestamp rather than a plain "already loaded" flag so a long-lived
 * tab still picks up folios created elsewhere. The window matches the
 * `staleTime` on `useFolioTreeModel`'s own fallback query — the tree has
 * one freshness policy, not two.
 */
export const folioTreeSeedAtom = $atom({
  name: "lor.folio.tree.seed",
  schema: z
    .object({
      projectId: z.integer(),
      at: z.number(),
    })
    .optional(),
});
