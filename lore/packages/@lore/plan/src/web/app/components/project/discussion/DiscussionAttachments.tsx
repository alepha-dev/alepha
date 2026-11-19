import { FileImage } from "@alepha/ui";
import {
  AttachmentLightbox,
  attachmentPreview,
  type I18n,
} from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { FileText, Loader2, X } from "lucide-react";
import { type MouseEvent, useState } from "react";

/**
 * One file on a comment, posted or waiting in the composer.
 */
export interface DiscussionAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  /**
   * Where the file downloads from. Absent for a file just uploaded, which
   * then resolves through its id.
   */
  url?: string;
}

export interface DiscussionAttachmentsProps {
  items: DiscussionAttachment[];
  /**
   * Given, each tile carries a remove button: the composer's pending files.
   */
  onRemove?: (id: string) => void;
  /**
   * Uploads still in flight, drawn as placeholder tiles after the others.
   */
  uploading?: number;
  disabled?: boolean;
}

/**
 * A comment's files as tiles, the same in the composer and in the thread:
 * an image is its own thumbnail and zooms in the lightbox, any other file is
 * a tile with its name and size that opens in a tab.
 *
 * Shared by a quest's and a feedback item's discussion, so a file looks the
 * same before it is sent and after.
 */
const DiscussionAttachments = (props: DiscussionAttachmentsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [openId, setOpenId] = useState<string | null>(null);
  const isImage = (file: DiscussionAttachment) =>
    attachmentPreview(file.name, file.mimeType).kind === "image";
  const href = (file: DiscussionAttachment) =>
    file.url ?? `/api/files/${file.id}`;

  if (props.items.length === 0 && !props.uploading) return null;

  // A plain click on an image zooms it; a modified click keeps the anchor's
  // own behaviour (a new tab).
  const zoom = (file: DiscussionAttachment) => (event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    setOpenId(file.id);
  };

  return (
    <>
      <ul className="flex flex-wrap gap-2">
        {props.items.map((file) => (
          <li key={file.id} className="group relative">
            <a
              href={href(file)}
              target="_blank"
              rel="noreferrer"
              onClick={isImage(file) ? zoom(file) : undefined}
              title={file.name}
              className="border-border bg-background hover:border-foreground/30 block size-20 overflow-hidden rounded-lg border transition-colors"
            >
              {isImage(file) ? (
                <FileImage
                  id={file.id}
                  alt={file.name}
                  className="size-full cursor-zoom-in object-cover"
                />
              ) : (
                <span className="flex size-full flex-col justify-between p-2 text-xs">
                  <FileText className="text-muted-foreground size-4" />
                  <span className="line-clamp-2 break-all">{file.name}</span>
                  <span className="text-muted-foreground">
                    {Math.max(1, Math.round(file.size / 1024))} KB
                  </span>
                </span>
              )}
            </a>
            {props.onRemove && (
              <button
                type="button"
                aria-label={tr("discussion.removeAttachment")}
                disabled={props.disabled}
                onClick={() => props.onRemove?.(file.id)}
                className="bg-background border-border text-muted-foreground hover:text-foreground absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border shadow-sm"
              >
                <X className="size-3" />
              </button>
            )}
          </li>
        ))}
        {Array.from({ length: props.uploading ?? 0 }, (_, index) => (
          <li
            key={`uploading-${index}`}
            className="border-border bg-muted/40 text-muted-foreground flex size-20 items-center justify-center rounded-lg border"
          >
            <Loader2 className="size-4 animate-spin" />
          </li>
        ))}
      </ul>
      <AttachmentLightbox
        items={props.items.filter(isImage).map((file) => ({
          fileId: file.id,
          name: file.name,
          mimeType: file.mimeType,
        }))}
        openId={openId}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
      />
    </>
  );
};

export default DiscussionAttachments;
