import { Button } from "@alepha/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import type { EditorView } from "@codemirror/view";
import { useI18n } from "alepha/react/i18n";

import type { I18n } from "@/web/app/services/I18n.ts";

import { markdownCommands } from "./markdownCommands.ts";
import { MARKDOWN_TOOLBAR_GROUPS } from "./markdownToolbarActions.ts";

export interface MarkdownFormatToolbarProps {
  /**
   * The live editor. Non-nullable on purpose: the caller mounts this only
   * once the view exists, so there is no "not ready yet" state to model.
   */
  view: EditorView;
  /**
   * Pull the bar out to the frame's edges. The framed editor pads itself
   * (`p-3`), and a bar sitting inside that padding reads as a widget in the
   * field rather than the field's own header; the bare variant has no
   * padding to escape.
   */
  flush?: boolean;
}

/**
 * The fixed row of formatting buttons at the top of a description field
 * (feedback #2056). The floating {@link MarkdownSelectionToolbar} stays:
 * that one appears over a selection, this one is always there, so a reader
 * who does not know the markdown syntax can see what the field offers
 * before typing a word.
 *
 * Same buttons, same commands, same table (`MARKDOWN_TOOLBAR_GROUPS`), so
 * the two never disagree. Mounted in edit mode only: preview has nothing
 * to format.
 *
 * No keyboard shortcuts in the tooltips because none are bound: the
 * editor's own keymap covers editing (⌘D duplicates a line, Tab accepts a
 * completion) and no formatting command has a key. When one gets bound in
 * `codeMirrorSetup.ts`, the label is where to say so.
 */
const MarkdownFormatToolbar = (props: MarkdownFormatToolbarProps) => {
  const { tr } = useI18n<I18n, "en">();

  return (
    <div
      data-testid="markdown-format-toolbar"
      role="toolbar"
      // `pr-10`: the mode toggle floats in the frame's top-right corner
      // (see `LoreEditor`), and the bar must not run underneath it.
      className={`border-border mb-2 flex flex-wrap items-center gap-0.5 border-b px-2 py-1 pr-10 ${props.flush ? "-mx-3 -mt-3" : ""}`}
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
                      // No `title`: a real tooltip and the browser's own
                      // would both fire. See the selection toolbar.
                      className="lore-md-toolbar-button text-muted-foreground hover:text-foreground"
                      // `mousedown`, not `click`, and prevented: a click
                      // would blur the editor first and lose the selection
                      // the command is about to act on.
                      onMouseDown={(event) => {
                        event.preventDefault();
                        markdownCommands[id](props.view);
                      }}
                    >
                      <Icon className="size-3.5" />
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

export default MarkdownFormatToolbar;
