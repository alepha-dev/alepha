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
 * where the work actually happens. The blob and activity ENDPOINTS are
 * untouched — only their browser UI went — so blob support can come back
 * into the workspace later without a server change.
 */
const FoliosLayout = () => {
  const name = useRouterState().name ?? "";

  return (
    <div className="bg-background flex h-full min-h-0 flex-1">
      <main className="flex min-h-0 min-w-0 flex-1">
        {name === "projectFolios" ? <FolioWorkspace empty /> : <NestedView />}
      </main>
    </div>
  );
};

export default FoliosLayout;
