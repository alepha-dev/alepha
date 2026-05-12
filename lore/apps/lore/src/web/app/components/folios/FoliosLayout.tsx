import { useStore } from "alepha/react";
import { NestedView, useRouterState } from "alepha/react/router";
import { userFoliosAtom } from "../../atoms/userFoliosAtom.ts";
import FoliosEmpty from "./FoliosEmpty.tsx";
import FoliosSidebar from "./FoliosSidebar.tsx";

const FoliosLayout = () => {
  const [folios = []] = useStore(userFoliosAtom);
  const routerState = useRouterState();
  const name = routerState.name ?? "";

  // When the user has no folios at all and isn't already creating one, show
  // the central empty state in the main pane so the right side isn't a blank
  // surface.
  const showEmpty = folios.length === 0 && name === "campaignFolios";

  return (
    <div className="bg-background flex h-full min-h-0 flex-1">
      <FoliosSidebar />
      <main className="min-h-0 flex-1 overflow-auto">
        {showEmpty ? <FoliosEmpty /> : <NestedView />}
      </main>
    </div>
  );
};

export default FoliosLayout;
