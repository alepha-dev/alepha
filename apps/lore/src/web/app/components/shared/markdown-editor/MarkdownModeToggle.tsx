import { Button } from "@alepha/ui/components/ui/button";
import { useI18n } from "alepha/react/i18n";
import { BookOpen, Pencil } from "lucide-react";
import type { I18n } from "@/web/app/services/I18n.ts";
import type { MarkdownEditorMode } from "./MarkdownEditorInner.tsx";

export interface MarkdownModeToggleProps {
  mode: MarkdownEditorMode;
  onChange: (mode: MarkdownEditorMode) => void;
  disabled?: boolean;
  /**
   * Drop the text label and render the icon alone.
   *
   * Used on the folio title line, where the control sits beside the
   * document's own heading and a word next to it would read as part of the
   * title. The accessible name is kept on the button either way — this
   * changes what is drawn, never what a screen reader gets.
   */
  iconOnly?: boolean;
  /**
   * Extra classes on the button. The folio workspace uses it to give the
   * floating toggle a surface of its own — the control hovers over the
   * document there, so it needs a background and a border that the default
   * ghost variant deliberately does not have.
   */
  className?: string;
  /**
   * Extra classes on the icon, for when the button is sized past the
   * default. Without it a bigger button just draws more padding around the
   * same 14px glyph.
   */
  iconClassName?: string;
}

/**
 * Flips a `MarkdownEditor` between its rendered and raw faces.
 *
 * Used by the quest surfaces, which have no chrome of their own to hang the
 * control on, and by the folio workspace, where it floats over the top-right
 * corner of the document pane. ⌘E drives the same `mode` state from the
 * keyboard.
 *
 * `data-testid` and `data-mode` are a contract with `fillMarkdownEditor` in
 * `e2e/_helpers.ts`: CodeMirror is not mounted at all in view mode, so a
 * spec that types into the editor has to be able to find this control and
 * read which face is currently showing before it clicks.
 */
const MarkdownModeToggle = (props: MarkdownModeToggleProps) => {
  const { tr } = useI18n<I18n, "en">();
  const editing = props.mode === "edit";
  // The button always describes what clicking it DOES, not what is showing:
  // in Edit it offers Preview, in View it offers Edit.
  const label = String(
    editing ? tr("markdown.mode.preview") : tr("markdown.mode.edit"),
  );
  // Open book for "read this", pencil for "write this" — the same pair
  // Obsidian uses for its reading/editing views.
  const Icon = editing ? BookOpen : Pencil;

  return (
    <Button
      type="button"
      size={props.iconOnly ? "icon-sm" : "xs"}
      variant="ghost"
      className={props.className}
      disabled={props.disabled}
      data-testid="markdown-mode-toggle"
      data-mode={props.mode}
      // Carries the name in both variants — the icon-only one would
      // otherwise be an unlabelled button, and `title` gives a pointer user
      // the same word the text variant shows.
      aria-label={label}
      title={label}
      onClick={() => props.onChange(editing ? "view" : "edit")}
    >
      <Icon className={props.iconClassName ?? "size-3.5"} />
      {!props.iconOnly && label}
    </Button>
  );
};

export default MarkdownModeToggle;
