import { NestedView, useRouterState } from "alepha/react/router";

import FolioWorkspaceEmpty from "./editor/FolioWorkspaceEmpty.tsx";
import FolioWorkspaceShell from "./editor/FolioWorkspaceShell.tsx";

/**
 * Folio layout shell.
 *
 * `/folios` itself renders the workspace with nothing open (tree, empty
 * document pane), the way an editor sits before you pick a file. Everything
 * below it (a folio, or the create page) renders through the nested view.
 *
 * The directory table that used to own this route is gone. `FolioBrowser`
 * and its Recent Activity panel were a second, competing way to move
 * around the same folios, and the tree does that job inside the surface
 * where the work actually happens. The attachment and activity ENDPOINTS are
 * untouched (only their browser UI went), so attachment support can come back
 * into the workspace later without a server change.
 */
const FoliosLayout = () => {
  const state = useRouterState();
  const name = state.name ?? "";
  const currentFolioId: string | undefined = state.layers.find(
    (layer) => layer.name === "projectFoliosFolio",
  )?.props?.folio?.id;

  return (
    <div className="bg-background flex h-full min-h-0 flex-1">
      <main className="flex min-h-0 min-w-0 flex-1">
        {/* ⚠️ The shell sits OUTSIDE the branch, and that is load-bearing.
            The two branches are different component types in the same
            position, so React tears one down and builds the other on the
            step from `/folios` to a folio; below it, `NestedView` remounts
            the page on every folio switch (#Q2349). Only what is above both
            survives, so the tree and the pane state live in the shell.

            Before the hoist the whole workspace sat inside this ternary, and
            the step from the list to a folio destroyed the tree: feedback
            #14 came back as #2100 that way. */}
        <FolioWorkspaceShell currentFolioId={currentFolioId}>
          {name === "projectFolios" ? <FolioWorkspaceEmpty /> : <NestedView />}
        </FolioWorkspaceShell>
      </main>
    </div>
  );
};

export default FoliosLayout;
