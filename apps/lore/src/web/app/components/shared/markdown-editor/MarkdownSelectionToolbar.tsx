import { Button } from "@alepha/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import type { EditorView } from "@codemirror/view";
import { useI18n } from "alepha/react/i18n";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  Quote,
  SquareCode,
} from "lucide-react";
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

interface ToolbarAction {
  id: MarkdownCommandId;
  /**
   * ⚠️ These are `folios.editor.*` keys in a component the quest surfaces
   * mount too. They are reused rather than duplicated under `markdown.*`
   * because both locales already carry every one of them and the words are
   * generic ("Heading 1", "Quote") - a parallel namespace would be twelve
   * new strings saying the same thing. If this toolbar ever needs a label
   * the menubar does not have, take the group list as a prop from the
   * caller instead of growing this union.
   */
  labelKey:
    | "folios.editor.action.bold"
    | "folios.editor.action.italic"
    | "folios.editor.action.code"
    | "folios.editor.action.heading1"
    | "folios.editor.action.heading2"
    | "folios.editor.action.heading3"
    | "folios.editor.action.bullet-list"
    | "folios.editor.action.quote"
    | "folios.editor.action.code-block";
  Icon: typeof Bold;
}

/**
 * Grouped, and rendered with a rule between groups, because nine
 * undifferentiated icons stop being a quick gesture and start being a
 * ribbon. The order is inline formatting → block structure → containers.
 *
 * Every command already existed in `markdownCommands` and was reachable
 * only from the Insert menu; nothing here is a new transform.
 */
const ACTION_GROUPS: ToolbarAction[][] = [
  [
    { id: "edit.bold", labelKey: "folios.editor.action.bold", Icon: Bold },
    {
      id: "edit.italic",
      labelKey: "folios.editor.action.italic",
      Icon: Italic,
    },
    { id: "edit.code", labelKey: "folios.editor.action.code", Icon: Code },
  ],
  [
    {
      id: "insert.heading1",
      labelKey: "folios.editor.action.heading1",
      Icon: Heading1,
    },
    {
      id: "insert.heading2",
      labelKey: "folios.editor.action.heading2",
      Icon: Heading2,
    },
    {
      id: "insert.heading3",
      labelKey: "folios.editor.action.heading3",
      Icon: Heading3,
    },
  ],
  [
    {
      id: "insert.bulletList",
      labelKey: "folios.editor.action.bullet-list",
      Icon: List,
    },
    { id: "insert.quote", labelKey: "folios.editor.action.quote", Icon: Quote },
    {
      id: "insert.codeBlock",
      labelKey: "folios.editor.action.code-block",
      Icon: SquareCode,
    },
  ],
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
      {ACTION_GROUPS.map((group) => (
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
                      // `hover:bg-accent` twice, the second behind `dark:`,
                      // to defeat the ghost variant's own
                      // `dark:hover:bg-muted/50`. A half-opacity muted is
                      // near-invisible on this bar specifically: the bar is
                      // `bg-popover`, which in dark sits at L 0.22, and
                      // muted at 50% over it lands within a couple of
                      // percent of the surface. Accent is L 0.33 and reads
                      // cleanly. Everywhere else the ghost variant sits on
                      // `background`, where its default is fine - this is a
                      // property of the surface, not a fault in the variant.
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
