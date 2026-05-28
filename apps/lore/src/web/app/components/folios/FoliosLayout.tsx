import { NestedView, useRouterState } from "alepha/react/router";
import ArchiveActivityPanel from "./ArchiveActivityPanel.tsx";
import ArchiveBrowser from "./ArchiveBrowser.tsx";

/**
 * Archive layout shell. Two modes:
 * - browse (`campaignFolios`) → full-pane `ArchiveBrowser` table with
 *   the collapsible Recent Activity panel on the right (Lore #105).
 * - everything else (folio view / edit / new) → full-pane nested view.
 *
 * The split-pane experiment was dropped: folios get their own page.
 */
const FoliosLayout = () => {
  const name = useRouterState().name ?? "";
  const isBrowse = name === "campaignFolios";

  return (
    <div className="bg-background flex h-full min-h-0 flex-1">
      <main className="min-h-0 flex-1 overflow-auto">
        {isBrowse ? <ArchiveBrowser /> : <NestedView />}
      </main>
      {isBrowse && <ArchiveActivityPanel />}
    </div>
  );
};

export default FoliosLayout;
