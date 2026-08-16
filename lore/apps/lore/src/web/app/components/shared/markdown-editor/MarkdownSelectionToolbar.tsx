import { Button } from "@alepha/ui/components/ui/button";
import type { EditorView } from "@codemirror/view";
import { useI18n } from "alepha/react/i18n";
import { Bold, Code, Italic } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { I18n } from "@/web/app/services/I18n.ts";
import {
  type MarkdownCommandId,
  markdownCommands,
} from "./markdownCommands.ts";

export interface MarkdownSelectionToolbarProps {
  /**
   * The live editor. Non-nullable on purpose: the caller mounts this only
   * once the view exists, so there is no "not ready yet" state to model.
   */
  view: EditorView;
}

interface ToolbarPosition {
  left: number;
  top: number;
}

const ACTIONS: Array<{
  id: MarkdownCommandId;
  labelKey:
    | "markdown.mode.bold"
    | "markdown.mode.italic"
    | "markdown.mode.code";
  Icon: typeof Bold;
}> = [
  { id: "edit.bold", labelKey: "markdown.mode.bold", Icon: Bold },
  { id: "edit.italic", labelKey: "markdown.mode.italic", Icon: Italic },
  { id: "edit.code", labelKey: "markdown.mode.code", Icon: Code },
];

/**
 * A small floating bar over the current selection — select a word, format
 * it without leaving the text.
 *
 * Positioned with `position: fixed` against viewport coordinates from
 * `view.coordsAtPos`, so it does not need a positioned ancestor and cannot
 * be clipped by the document pane's `overflow`.
 *
 * ## Why `selectionchange` and not a CodeMirror update listener
 *
 * The extension list is fixed when the view is constructed, and this
 * component mounts alongside rather than inside it — adding a listener
 * afterwards would mean reconfiguring the editor. `selectionchange` on the
 * document is the same signal one level up, and it also fires for the
 * drag-select and double-click paths that are the whole point of this
 * control.
 */
const MarkdownSelectionToolbar = (props: MarkdownSelectionToolbarProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [position, setPosition] = useState<ToolbarPosition | null>(null);

  const sync = useCallback(() => {
    const view = props.view;
    const range = view.state.selection.main;
    // Nothing selected, or the caret is merely sitting somewhere — a
    // toolbar over an empty selection has nothing to format.
    if (range.empty || !view.hasFocus) return setPosition(null);

    const from = view.coordsAtPos(range.from);
    const to = view.coordsAtPos(range.to);
    if (!from || !to) return setPosition(null);

    // Above the selection, centred on it. `coordsAtPos` is already in
    // viewport space, which is what `fixed` wants.
    setPosition({
      left: (from.left + to.right) / 2,
      top: Math.min(from.top, to.top),
    });
  }, [props.view]);

  useEffect(() => {
    sync();
    document.addEventListener("selectionchange", sync);
    // Scrolling moves the text out from under a `fixed` element, so the bar
    // has to follow it or it ends up pointing at the wrong words. `true`
    // captures scrolls on the pane, not just the window.
    window.addEventListener("scroll", sync, true);
    window.addEventListener("resize", sync);
    return () => {
      document.removeEventListener("selectionchange", sync);
      window.removeEventListener("scroll", sync, true);
      window.removeEventListener("resize", sync);
    };
  }, [props.view, sync]);

  if (!position) return null;

  return (
    <div
      data-testid="markdown-selection-toolbar"
      className="bg-popover border-border pointer-events-auto fixed z-50 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-md border p-0.5 shadow-md"
      style={{ left: position.left, top: position.top - 6 }}
    >
      {ACTIONS.map(({ id, labelKey, Icon }) => {
        const label = String(tr(labelKey));
        return (
          <Button
            key={id}
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={label}
            title={label}
            // `mousedown`, not `click`, and prevented: a click would blur
            // the editor first, collapsing the very selection the command
            // is about to act on.
            onMouseDown={(event) => {
              event.preventDefault();
              markdownCommands[id](props.view);
            }}
          >
            <Icon className="size-3" />
          </Button>
        );
      })}
    </div>
  );
};

export default MarkdownSelectionToolbar;
