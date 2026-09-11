import { PaneRail } from "@alepha/ui/components/pane-rail/pane-rail";
import { useI18n } from "alepha/react/i18n";
import type { ReactElement } from "react";

import type { I18n } from "@/web/app/services/I18n.ts";

export interface FolioTreeRailProps {
  onExpand: () => void;
}

/**
 * The way back once the tree is collapsed: the kit's 36px `PaneRail`,
 * mirroring `FolioInspectorRail` on the other side of the document.
 *
 * It exists because the collapse button in the tree's own header
 * (feedback #P2136) disappears with the pane it closes. Without a rail the
 * only way back is the menubar's View entry or ⌘\, which is a keyboard
 * shortcut and a menu for a pane the reader just closed with a click - the
 * asymmetry the inspector never had.
 *
 * ⚠️ Rendered only where the tree would otherwise be a COLUMN. Below
 * `TREE_DRAWER_BELOW` the pane is an overlay that defaults closed, so a rail
 * there would put a permanent 36px strip on every narrow viewport for a pane
 * nobody collapsed - changing the default layout rather than offering a way
 * back from an action.
 */
const FolioTreeRail = (props: FolioTreeRailProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();

  return (
    <PaneRail
      side="left"
      label={String(tr("folios.editor.tree.expand"))}
      onExpand={props.onExpand}
    />
  );
};

export default FolioTreeRail;
