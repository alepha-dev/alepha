import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@alepha/ui/components/ui/context-menu";
import { useI18n } from "alepha/react/i18n";
import { FilePlus, FolderPlus } from "lucide-react";
import type { ReactElement } from "react";

import type { I18n } from "../../../../services/I18n.ts";
import type { FolioTreeCommands } from "./useFolioTreeModel.ts";

export interface FolioTreeRootContextMenuProps {
  commands: FolioTreeCommands;
}

/**
 * The right-click menu for the empty space BELOW the last row, and the
 * element that space is made of.
 *
 * `FolioTreeContextMenu` is mounted per row, so until this existed the
 * largest target in the pane - everything under the tree - answered a
 * right-click with the browser's own menu (feedback #P2134). The two verbs
 * are the ones the header buttons already carry; this is a third door to
 * them, not new behaviour.
 *
 * ⚠️ **The trigger is a FILLER element, not the scroll container.** Wrapping
 * the container would put this menu behind every row as well and shadow the
 * row's own, which is the menu that can rename and delete. A sibling that
 * takes the leftover space instead can never contain a row, so the two
 * cannot compete - no event-target sniffing, and nothing to keep in step
 * when the rows change shape. It measures `flex-1` against the container's
 * `flex-col`, so it is exactly the empty space and collapses to nothing the
 * moment the rows fill the pane.
 *
 * ⚠️ **Both commands are called with NO argument, which is the root.**
 * `useFolioTreeModel`'s `createFolio` / `createDirectory` send
 * `directoryId` / `parentId` straight through, so an omitted parent IS the
 * project root - the row menu's own items pass `node.id` for the same
 * reason. Empty space belongs to no directory, and inheriting the last
 * selection would file a folio somewhere the click never named.
 *
 * Two items and no more: Open, rename and delete are all questions about a
 * row, and there is no row here.
 *
 * Mounted only under `canWrite` by the caller, the same permission behind
 * the header buttons and the row menu's own create items. A Viewer gets the
 * browser's menu back rather than one whose every item answers 403.
 */
const FolioTreeRootContextMenu = (
  props: FolioTreeRootContextMenuProps,
): ReactElement => {
  const { tr } = useI18n<I18n, "en">();

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div data-slot="folio-tree-root-area" className="min-h-0 flex-1" />
        }
      />
      <ContextMenuContent>
        <ContextMenuItem onClick={() => props.commands.createFolio()}>
          <FilePlus className="size-4" />
          {tr("folios.editor.tree.new-folio")}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => props.commands.createDirectory()}>
          <FolderPlus className="size-4" />
          {tr("folios.editor.tree.new-directory")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};

export default FolioTreeRootContextMenu;
