import { PaneRail } from "@alepha/ui/components/pane-rail/pane-rail";
import { useI18n } from "alepha/react/i18n";
import type { ReactElement } from "react";

import type { I18n } from "../../../../services/I18n.ts";

export interface FolioInspectorRailProps {
  onExpand: () => void;
}

/**
 * What the inspector leaves behind when it is closed: the kit's `PaneRail`,
 * the width of one button, with the control that brings the pane back.
 *
 * Collapsing to nothing at all was the original behaviour, and it stranded
 * the reader: the outline, history and links were gone with no visible
 * way back, since the only routes left were ⇧⌘\ and a View menu that does
 * not advertise itself. A pane that can be closed has to say how to
 * reopen it.
 */
const FolioInspectorRail = (props: FolioInspectorRailProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();

  return (
    <PaneRail
      side="right"
      label={String(tr("folios.editor.inspector.expand"))}
      onExpand={props.onExpand}
    />
  );
};

export default FolioInspectorRail;
