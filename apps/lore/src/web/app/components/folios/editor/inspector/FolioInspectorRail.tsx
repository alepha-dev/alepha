import { useI18n } from "alepha/react/i18n";
import { PanelRightOpen } from "lucide-react";
import type { ReactElement } from "react";
import type { I18n } from "../../../../services/I18n.ts";

export interface FolioInspectorRailProps {
  onExpand: () => void;
}

/**
 * What the inspector leaves behind when it is closed: a rail the width of
 * one button, with the control that brings the pane back.
 *
 * Collapsing to nothing at all was the original behaviour, and it stranded
 * the reader — the outline, history and links were gone with no visible
 * way back, since the only routes left were ⇧⌘\ and a View menu that does
 * not advertise itself. A pane that can be closed has to say how to
 * reopen it.
 */
const FolioInspectorRail = (props: FolioInspectorRailProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();

  return (
    <div className="border-border flex w-9 flex-none flex-col items-center border-l pt-1.5">
      <button
        type="button"
        onClick={props.onExpand}
        aria-label={String(tr("folios.editor.inspector.expand"))}
        title={String(tr("folios.editor.inspector.expand"))}
        className="text-muted-foreground hover:text-foreground hover:bg-accent flex size-7 items-center justify-center rounded-md transition-colors"
      >
        <PanelRightOpen className="size-4" />
      </button>
    </div>
  );
};

export default FolioInspectorRail;
