import { Badge } from "@alepha/ui/components/ui/badge";
import { useI18n } from "alepha/react/i18n";
import { Folder, Plus, X } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import type { I18n } from "../../../../services/I18n.ts";

export interface FolioMetaBarProps {
  directoryName: string;
  tags: string[];
  shortId?: number;
  wordCount: number;
  revisionCount?: number;
  disabled?: boolean;
  /**
   * Disables ONLY the directory chip — separate from `disabled` because
   * create mode (no folio row exists yet, so there's nothing for
   * `folio.move` to act on) still has fully functional tags and title
   * editing. `disabled` alone is the "protected and locked" case; the two
   * are independent booleans, not one subsuming the other.
   */
  moveDisabled?: boolean;
  onOpenMove: () => void;
  onAddTag: () => void;
  onRemoveTag: (tag: string) => void;
  /**
   * Rendered at the far right of the row, after the word/revision count.
   *
   * The view/edit toggle lives here since the document heading was removed —
   * this row is the only chrome the document has left, and the toggle is a
   * control over the body exactly like the chips beside it are controls over
   * the folio.
   */
  trailing?: ReactNode;
}

/**
 * The line under the title: where the folio lives, how it is tagged, and
 * how big it is. Every chip is a control — the directory chip opens the
 * move picker, the tags are removable, the dashed chip adds one.
 */
const FolioMetaBar = (props: FolioMetaBarProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  return (
    // No top margin: the header wrapper's own padding is the spacing now, and
    // an `mt-4` on top of it double-counted the gap under the menubar.
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={props.onOpenMove}
        disabled={props.disabled || props.moveDisabled}
        className="border-border text-muted-foreground hover:text-foreground flex h-6.5 items-center gap-1.5 rounded-md border px-2 text-xs disabled:pointer-events-none disabled:opacity-50"
      >
        <Folder className="size-3" />
        {props.directoryName}
      </button>

      {props.tags.map((tag) => (
        // Tinted in the primary hue, as the design has them. Tags are the
        // one chip on this row that carries colour, which is what tells
        // them apart from the directory chip sitting beside them.
        <Badge
          key={tag}
          variant="outline"
          className="group border-primary/30 bg-primary/10 text-primary gap-1 text-xs"
        >
          {tag}
          <button
            type="button"
            aria-label={String(tr("folios.editor.tag.remove"))}
            onClick={() => props.onRemoveTag(tag)}
            disabled={props.disabled}
            // `hidden`, not `opacity-0`: an invisible button still takes
            // its width, which is what put a gap of dead space on the
            // right of every tag chip.
            className="hidden group-hover:inline-flex disabled:pointer-events-none"
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}

      <button
        type="button"
        onClick={props.onAddTag}
        disabled={props.disabled}
        className="border-border text-muted-foreground hover:text-foreground flex h-6.5 items-center gap-1 rounded-md border border-dashed px-2 text-xs"
      >
        <Plus className="size-3" />
        {tr(
          props.tags.length
            ? "folios.editor.tag.add-more"
            : "folios.editor.tag.add",
        )}
      </button>

      <div className="flex-1" />
      <span className="text-muted-foreground folio-mono text-xs tabular-nums">
        {props.shortId
          ? tr(
              // "1 revisions" reads as a bug even though it is only a
              // missing plural, and this line sits under every folio
              // title in the app.
              props.revisionCount === 1
                ? "folios.editor.meta.saved-one"
                : "folios.editor.meta.saved",
              {
                args: [
                  String(props.shortId),
                  String(props.wordCount),
                  String(props.revisionCount ?? 0),
                ],
              },
            )
          : // No shortId means the folio does not exist server-side yet. This
            // used to read "Draft · not saved yet", which was true and useless:
            // an existing folio auto-saves, so the only state that line ever
            // described was the one where the reader has not pressed Save yet —
            // and the Save button is right there saying so. The word count is
            // what the line can usefully carry meanwhile.
            tr(
              props.wordCount === 1
                ? "folios.editor.meta.draft-one"
                : "folios.editor.meta.draft",
              { args: [String(props.wordCount)] },
            )}
      </span>
      {/* A hairline between the count and whatever trails it — the count is
          read-only text and the trailing control is not, so the rule marks
          where the row stops reporting and starts offering. Rendered WITH the
          trailing node, never alone: a divider with nothing after it is just a
          mark. `aria-hidden` because it separates visually and says nothing. */}
      {props.trailing && (
        <>
          <div aria-hidden className="bg-border h-5.5 w-px" />
          {props.trailing}
        </>
      )}
    </div>
  );
};

export default FolioMetaBar;
