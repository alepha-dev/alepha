import { Button } from "@alepha/ui/components/ui/button";
import { File, Image as ImageIcon, X } from "lucide-react";

export interface QuestAttachmentChipProps {
  fileId: string;
  name: string;
  isImage: boolean;
  onOpen?: (fileId: string) => void;
  onRemove?: (fileId: string) => void;
  disabled?: boolean;
  /**
   * Plays the enter animation. Only the chip added in this session gets it:
   * replaying it across the row on every render would make an unrelated
   * upload look like everything changed.
   */
  isNew?: boolean;
}

/**
 * One attachment: a rounded-square chip carrying a type glyph and the real
 * filename, per the mockup.
 *
 * The name comes from `listQuestAttachments` rather than being probed in the
 * browser. The chip shows what the file IS, so guessing from whether an
 * `<img>` happened to load would put a wrong icon on anything slow or
 * briefly unreachable.
 */
const QuestAttachmentChip = (props: QuestAttachmentChipProps) => (
  <div
    className={`group/chip relative shrink-0 ${
      props.isNew ? "animate-in zoom-in-95 fade-in duration-300" : ""
    }`}
  >
    <button
      type="button"
      onClick={() => props.onOpen?.(props.fileId)}
      title={props.name}
      className="bg-muted/60 hover:bg-muted flex h-8 max-w-[220px] items-center gap-2 rounded-lg px-2.5 text-sm transition-colors"
    >
      <span className="text-muted-foreground shrink-0">
        {props.isImage ? (
          <ImageIcon className="size-4" />
        ) : (
          <File className="size-4" />
        )}
      </span>
      <span className="truncate">{props.name}</span>
    </button>

    {!props.disabled && props.onRemove && (
      <Button
        type="button"
        variant="secondary"
        size="icon-xs"
        aria-label={`Remove ${props.name}`}
        className="absolute -top-1.5 -right-1.5 opacity-0 shadow transition-opacity group-hover/chip:opacity-100 focus-visible:opacity-100"
        onClick={() => props.onRemove?.(props.fileId)}
      >
        <X className="size-3" />
      </Button>
    )}
  </div>
);

export default QuestAttachmentChip;
