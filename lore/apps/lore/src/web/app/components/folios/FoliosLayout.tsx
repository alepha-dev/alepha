import { NestedView, useRouterState } from "alepha/react/router";
import FolioActivityPanel from "./FolioActivityPanel.tsx";
import FolioBrowser from "./FolioBrowser.tsx";

/**
 * Folio layout shell. Two modes:
 * - browse (`projectFolios`) → full-pane `FolioBrowser` table with
 *   the collapsible Recent Activity panel on the right (Lore #105).
 * - everything else (folio view / edit / new) → full-pane nested view.
 *
 * The split-pane experiment was dropped: folios get their own page.
 */
const FoliosLayout = () => {
  const name = useRouterState().name ?? "";
  const isBrowse = name === "projectFolios";

  return (
    <div className="bg-background flex h-full min-h-0 flex-1">
      <main className="min-h-0 flex-1 overflow-auto">
        {isBrowse ? <FolioBrowser /> : <NestedView />}
      </main>
      {isBrowse && <FolioActivityPanel />}
    </div>
  );
};

export default FoliosLayout;
