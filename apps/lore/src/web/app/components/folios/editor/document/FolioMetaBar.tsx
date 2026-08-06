import { Badge } from "@alepha/ui/components/ui/badge";
import { useI18n } from "alepha/react/i18n";
import { Folder, Plus, X } from "lucide-react";
import type { ReactElement } from "react";
import type { I18n } from "../../../../services/I18n.ts";

export interface FolioMetaBarProps {
  directoryName: string;
  tags: string[];
  shortId?: number;
  wordCount: number;
  revisionCount?: number;
  disabled?: boolean;
  onOpenMove: () => void;
  onAddTag: () => void;
  onRemoveTag: (tag: string) => void;
}

/**
 * The line under the title: where the folio lives, how it is tagged, and
 * how big it is. Every chip is a control — the directory chip opens the
 * move picker, the tags are removable, the dashed chip adds one.
 */
const FolioMetaBar = (props: FolioMetaBarProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={props.onOpenMove}
        disabled={props.disabled}
        className="border-border text-muted-foreground hover:text-foreground flex h-6.5 items-center gap-1.5 rounded-md border px-2 text-xs"
      >
        <Folder className="size-3" />
        {props.directoryName}
      </button>

      {props.tags.map((tag) => (
        <Badge key={tag} variant="outline" className="group gap-1 text-xs">
          {tag}
          <button
            type="button"
            aria-label={String(tr("folios.editor.tag.remove"))}
            onClick={() => props.onRemoveTag(tag)}
            className="opacity-0 transition-opacity group-hover:opacity-100"
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
          ? tr("folios.editor.meta.saved", {
              args: [
                String(props.shortId),
                String(props.wordCount),
                String(props.revisionCount ?? 0),
              ],
            })
          : tr("folios.editor.meta.draft")}
      </span>
    </div>
  );
};

export default FolioMetaBar;
