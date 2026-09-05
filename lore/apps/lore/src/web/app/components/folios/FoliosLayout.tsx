import { NestedView, useRouterState } from "alepha/react/router";

import FolioWorkspace from "./editor/FolioWorkspace.tsx";

/**
 * Folio layout shell.
 *
 * `/folios` itself renders the workspace with nothing open — tree, empty
 * document pane, no chrome — the way an editor sits before you pick a
 * file. Everything below it (a folio, or the create page) renders through
 * the nested view.
 *
 * The directory table that used to own this route is gone. `FolioBrowser`
 * and its Recent Activity panel were a second, competing way to move
 * around the same folios, and the tree does that job inside the surface
 * where the work actually happens. The attachment and activity ENDPOINTS are
 * untouched — only their browser UI went — so attachment support can come back
 * into the workspace later without a server change.
 */
const FoliosLayout = () => {
  const name = useRouterState().name ?? "";

  return (
    <div className="bg-background flex h-full min-h-0 flex-1">
      <main className="flex min-h-0 min-w-0 flex-1">
        {/* ⚠️ This ternary REMOUNTS the workspace, and that is load-bearing
            knowledge rather than a detail. The two branches are different
            component types in the same position, so React tears one down and
            builds the other: walking from `/folios` to `/folios/:shortId`
            destroys the tree and everything it was holding.

            That is how feedback #14 came back as #2100. `useFolioTreeModel`
            guarded its one-time collapse seed with a `useRef`, which survives
            re-renders but not this, so the seed ran again and re-collapsed
            every directory except the opened folio's own ancestors.

            Collapse state now lives in `folioTreeCollapsedAtom`, which
            survives a remount by construction. Anything else this tree must
            keep across the list-to-folio step belongs there too - a ref or a
            `useState` here will be silently thrown away. */}
        {name === "projectFolios" ? <FolioWorkspace empty /> : <NestedView />}
      </main>
    </div>
  );
};

export default FoliosLayout;
