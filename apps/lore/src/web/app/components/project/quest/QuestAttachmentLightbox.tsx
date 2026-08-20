import { MarkdownView } from "@alepha/ui/components/markdown-view/markdown-view";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { useI18n } from "alepha/react/i18n";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { useEffect, useState } from "react";
import type { I18n } from "@/web/app/services/I18n.ts";
import {
  attachmentPreview,
  PREVIEW_MAX_BYTES,
} from "./questAttachmentPreview.ts";

export interface PreviewableAttachment {
  fileId: string;
  name: string;
  mimeType: string;
}

export interface QuestAttachmentLightboxProps {
  /** Previewable attachments, in the order the row shows them. */
  items: PreviewableAttachment[];
  /** The one to open on, or `null` while closed. */
  openId: string | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Full-size viewer for attachments, with a carousel across the others.
 *
 * Images render as images; markdown renders as markdown; anything else
 * text-like renders inside a fenced block so the shared `MarkdownView` gives
 * it `rehype-highlight`'s colouring for free.
 *
 * HTML is shown as SOURCE, never rendered. It is an uploaded file served
 * from our own origin, so rendering it would execute it, and the fence is
 * what keeps a preview a preview.
 */
const QuestAttachmentLightbox = (props: QuestAttachmentLightboxProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [index, setIndex] = useState(0);
  const [text, setText] = useState<string | null>(null);
  const [tooLarge, setTooLarge] = useState(false);

  // Re-seed from the tile that was clicked. Keyed on `openId` rather than on
  // `open` so re-opening a different item moves the carousel instead of
  // resuming wherever the last visit left it.
  useEffect(() => {
    if (props.openId) {
      const at = props.items.findIndex((it) => it.fileId === props.openId);
      setIndex(at >= 0 ? at : 0);
    }
  }, [props.openId, props.items]);

  const count = props.items.length;
  const current = props.items[index];
  const preview = current
    ? attachmentPreview(current.name, current.mimeType)
    : { kind: "none" as const };
  const go = (delta: number) => setIndex((i) => (i + delta + count) % count);

  // Fetch the body only for what will be read as text, and only up to the
  // ceiling: a preview should never be the reason a tab stops responding.
  const fileId = current?.fileId;
  const isTextual = preview.kind === "markdown" || preview.kind === "text";
  useEffect(() => {
    if (!props.openId || !fileId || !isTextual) {
      setText(null);
      setTooLarge(false);
      return;
    }
    let cancelled = false;
    setText(null);
    setTooLarge(false);
    void fetch(`/api/files/${fileId}`, { credentials: "include" })
      .then(async (res) => {
        const size = Number(res.headers.get("content-length") ?? 0);
        if (size > PREVIEW_MAX_BYTES) {
          if (!cancelled) setTooLarge(true);
          return;
        }
        const body = await res.text();
        if (cancelled) return;
        if (body.length > PREVIEW_MAX_BYTES) {
          // No `content-length` on a streamed response, so the body is the
          // only honest measure and it has to be checked after the read.
          setTooLarge(true);
          return;
        }
        setText(body);
      })
      .catch(() => {
        if (!cancelled) setText(null);
      });
    return () => {
      cancelled = true;
    };
  }, [props.openId, fileId, isTextual]);

  // Arrow keys, because a carousel that only answers to clicks is a carousel
  // nobody pages through.
  useEffect(() => {
    if (!props.openId || count < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.openId, count]);

  if (!current) {
    return null;
  }

  return (
    <Dialog open={!!props.openId} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-[92vw] sm:max-w-3xl">
        <div className="flex items-center gap-2 pr-8">
          <DialogTitle className="min-w-0 flex-1 truncate text-sm">
            {current.name}
          </DialogTitle>
          {/* Same-origin, so `download` is honoured and saves under the real
              filename. The endpoint serves inline, which is right for the
              preview beside it and useless when you actually want the file. */}
          <a
            href={`/api/files/${current.fileId}`}
            download={current.name}
            className="text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center gap-1.5 text-xs hover:underline"
          >
            <Download className="size-3.5" />
            {tr("common.download")}
          </a>
        </div>

        <div className="flex items-center justify-center">
          {preview.kind === "image" && (
            <img
              src={`/api/files/${current.fileId}`}
              alt=""
              className="max-h-[70vh] w-auto max-w-full rounded-md object-contain"
            />
          )}

          {isTextual && (
            <div className="max-h-[70vh] w-full overflow-auto rounded-md">
              {tooLarge ? (
                <p className="text-muted-foreground p-4 text-sm italic">
                  {tr("quest.view.previewTooLarge")}
                </p>
              ) : text === null ? (
                <p className="text-muted-foreground p-4 text-sm italic">
                  {tr("loading")}
                </p>
              ) : (
                <MarkdownView
                  content={
                    preview.kind === "markdown"
                      ? text
                      : `\`\`\`${preview.language}\n${text}\n\`\`\``
                  }
                />
              )}
            </div>
          )}
        </div>

        {/* Nav sits in its own row under the content, not floating over it.
            Overlaid arrows are fine on an image, which has margins to spare,
            and unreadable on a text preview: the file fills the width, so the
            buttons landed on top of the code. */}
        {count > 1 && (
          <div className="flex items-center justify-center gap-3">
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              aria-label={tr("common.previous")}
              onClick={() => go(-1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <p className="text-muted-foreground text-xs">
              {tr("quest.view.attachmentsPosition", {
                args: [String(index + 1), String(count)],
              })}
            </p>
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              aria-label={tr("common.next")}
              onClick={() => go(1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default QuestAttachmentLightbox;
