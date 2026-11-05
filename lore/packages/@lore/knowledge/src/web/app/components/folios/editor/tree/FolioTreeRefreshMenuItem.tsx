import { ContextMenuItem } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { RefreshCw } from "lucide-react";
import type { ReactElement } from "react";

import { folioTreeRefreshingAtom } from "../../../../atoms/folioTreeRefreshingAtom.ts";
import type { FolioTreeCommands } from "./useFolioTreeModel.ts";

export interface FolioTreeRefreshMenuItemProps {
  commands: FolioTreeCommands;
}

/**
 * The Refresh item both folio tree context menus carry (#Q3120): the header's
 * refresh button, a third door to it for a pointer resting on a directory
 * deep in the list. The tree loads in one request, so refreshing a directory
 * IS refreshing the tree, and the item calls the same `commands.refresh()`.
 *
 * Disabled while a refresh is in flight, read from `folioTreeRefreshingAtom`
 * rather than a prop: see that atom's doc for why a prop would freeze inside
 * a memoised row.
 */
const FolioTreeRefreshMenuItem = (
  props: FolioTreeRefreshMenuItemProps,
): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const [state] = useStore(folioTreeRefreshingAtom);

  return (
    <ContextMenuItem
      onClick={() => props.commands.refresh()}
      disabled={state.refreshing}
    >
      <RefreshCw className="size-4" />
      {tr("folios.editor.tree.refresh")}
    </ContextMenuItem>
  );
};

export default FolioTreeRefreshMenuItem;
