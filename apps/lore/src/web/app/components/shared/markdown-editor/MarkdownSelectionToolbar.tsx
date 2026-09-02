import { Button } from "@alepha/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import type { EditorView } from "@codemirror/view";
import { useI18n } from "alepha/react/i18n";
import { useCallback, useEffect, useState } from "react";

import type { I18n } from "@/web/app/services/I18n.ts";

import { markdownCommands } from "./markdownCommands.ts";
import { MARKDOWN_TOOLBAR_GROUPS } from "./markdownToolbarActions.ts";

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
    // Reads CodeMirror's selection geometry, which only exists once the editor
    // has been committed to the DOM.
    // oxlint-disable-next-line react/set-state-in-effect
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
      {MARKDOWN_TOOLBAR_GROUPS.map((group) => (
        <div
          key={group[0].id}
          className="border-border flex items-center gap-0.5 border-l pl-1 first:border-l-0 first:pl-0"
        >
          {group.map(({ id, labelKey, Icon }) => {
            const label = String(tr(labelKey));
            return (
              <Tooltip key={id}>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      aria-label={label}
                      // ⚠️ No `title`. A real tooltip and the browser's own
                      // would both fire, and the native one draws a second
                      // black box a beat later, next to this one.
                      //
                      // The lift and its curves live in
                      // `.lore-md-toolbar-button` — two properties, two
                      // easings, which `duration-*` cannot express.
                      //
                      // `hover:bg-accent`, deliberately stronger than the
                      // ghost variant's `hover:bg-muted`. This bar floats
                      // over the document on `bg-popover`, which in the dark
                      // themes sits at L 0.21-0.23; muted lands 0.04-0.05
                      // above it, accent 0.09-0.11. A toolbar that appears
                      // on selection and disappears again wants the louder
                      // of the two.
                      //
                      // The `dark:` repeat is what defeats a dark-only
                      // override on the variant. There is none today (one
                      // was removed for quest #1643), but the repeat costs
                      // nothing and keeps this bar's choice explicit.
                      className="lore-md-toolbar-button hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent"
                      // `mousedown`, not `click`, and prevented: a click
                      // would blur the editor first, collapsing the very
                      // selection the command is about to act on.
                      onMouseDown={(event) => {
                        event.preventDefault();
                        markdownCommands[id](props.view);
                      }}
                    >
                      <Icon className="size-3" />
                    </Button>
                  }
                />
                <TooltipContent>{label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      ))}
    </div>
  );
};

export default MarkdownSelectionToolbar;
