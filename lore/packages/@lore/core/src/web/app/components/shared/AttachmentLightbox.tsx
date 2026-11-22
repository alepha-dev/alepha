import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  Segmented,
  cn,
} from "@alepha/ui";
import { MarkdownView } from "@alepha/ui/markdown";
import { useI18n } from "alepha/react/i18n";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { I18n } from "../../services/I18n.ts";
import AttachmentHtmlPreview from "./AttachmentHtmlPreview.tsx";
import { attachmentPreview, PREVIEW_MAX_BYTES } from "./attachmentPreview.ts";

export interface PreviewableAttachment {
  fileId: string;
  name: string;
  mimeType: string;
  /**
   * Where the file is served, when it is not `/api/files/:fileId`: an image
   * a markdown body links by URL (#Q3604). `fileId` is then only its key.
   */
  src?: string;
}

export interface AttachmentLightboxProps {
  /**
   * Previewable attachments, in the order the row shows them.
   */
  items: PreviewableAttachment[];
  /**
   * The one to open on, or `null` while closed.
   */
  openId: string | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Full-size viewer for attachments, with a carousel across the others.
 *
 * Shared between the quest attachment row and the feedback triage detail
 * (feedback #P2139). It was `QuestAttachmentLightbox` under
 * `components/project/quest/` and lifted here unchanged: it never knew what
 * a quest was, only `{ fileId, name, mimeType }`, which is why the lift was
 * a rename rather than work. Feedback's own rows carry `url` as
 * `/api/files/<id>`, so its `id` IS the `fileId` this asks for.
 *
 * ⚠️ The dialog is portalled, which is the point on the feedback side: that
 * detail is a narrow column, and a viewer that inherited its width would be
 * the tiny thumbnail the report was about.
 *
 * Images render as images; markdown renders as markdown; anything else
 * text-like renders inside a fenced block so the shared `MarkdownView` gives
 * it the highlighter's colouring for free (see `LANGUAGES` in `attachmentPreview.ts`).
 *
 * HTML opens on a Preview tab, RENDERED, with its source on a Code tab
 * beside it (#Q3268). The rule this replaces was "HTML is shown as source,
 * never rendered", and its reason still holds: nothing uploaded executes on
 * our origin. The preview keeps it by rendering in a sandboxed frame with an
 * opaque origin, which is `AttachmentHtmlPreview`'s whole job; read its
 * comment before touching the `sandbox` attribute.
 *
 * ⚠️ The code view scrolls on both axes INSIDE the dialog. Two things make
 * that true and both are easy to lose: the dialog's one grid column is
 * `minmax(0, 1fr)`, since an `auto` track grows to the longest line and the
 * dialog then cuts it; and for a code file the `<pre>` itself carries the
 * height limit, so its horizontal scrollbar stays in view rather than at the
 * foot of a block taller than the dialog. For the same reason the
 * highlighted `<code>` inside it, which `MarkdownView` makes its own
 * horizontal scroller, is widened to its content here: one scroller, the
 * `<pre>`, on both axes.
 *
 * The reader can maximize the dialog to the viewport (#Q3887): a screenshot
 * or an HTML page at half the screen is unreadable on a large monitor. The
 * choice is the viewer's own state, so it holds while paging through the
 * carousel and is forgotten when the viewer closes. Maximized, the dialog is
 * a fixed-height column whose content takes what the header, tabs and nav
 * leave (`flex-1 min-h-0`), and the image, the frame and the code view fill
 * it instead of the 70vh they are capped at otherwise.
 */
const AttachmentLightbox = (props: AttachmentLightboxProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [index, setIndex] = useState(0);
  const [text, setText] = useState<string | null>(null);
  const [tooLarge, setTooLarge] = useState(false);
  // Which face of an HTML file is up. Preview first: it is what the file
  // was attached to show.
  const [tab, setTab] = useState<"preview" | "code">("preview");
  // Maximized to the viewport (#Q3887). Not reset per file: it is how the
  // reader wants to look at the whole set.
  const [maximized, setMaximized] = useState(false);

  // Re-seed from the tile that was clicked. Keyed on `openId` rather than on
  // `open` so re-opening a different item moves the carousel instead of
  // resuming wherever the last visit left it.
  const [seed, setSeed] = useState({
    openId: props.openId,
    items: props.items,
  });
  // Keyed on `openId` only: the parent rebuilds `items` every render, so
  // comparing it snapped the carousel back to the clicked file whenever an
  // upload finished or metadata arrived while paging.
  if (seed.openId !== props.openId) {
    setSeed({ openId: props.openId, items: props.items });
    if (!props.openId) setMaximized(false);
    if (props.openId) {
      const at = props.items.findIndex((it) => it.fileId === props.openId);
      setIndex(at >= 0 ? at : 0);
    }
  }

  const count = props.items.length;
  const current = props.items[index];
  const preview = current
    ? attachmentPreview(current.name, current.mimeType)
    : { kind: "none" as const };
  const go = (delta: number) => setIndex((i) => (i + delta + count) % count);
  const isHtml = preview.kind === "text" && preview.html === true;

  // Each file opens on its preview, whatever tab the last one was left on.
  const [tabFor, setTabFor] = useState(current?.fileId);
  if (tabFor !== current?.fileId) {
    setTabFor(current?.fileId);
    setTab("preview");
  }

  // Fetch the body only for what will be read as text, and only up to the
  // ceiling: a preview should never be the reason a tab stops responding.
  const fileId = current?.fileId;
  const isTextual = preview.kind === "markdown" || preview.kind === "text";
  useEffect(() => {
    if (!props.openId || !fileId || !isTextual) {
      // Early return of the body fetch below — nothing to read, nothing to show.
      // oxlint-disable-next-line react/set-state-in-effect
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
      // The arrows belong to the Preview / Code tabs while one has focus.
      if (e.target instanceof Element && e.target.closest('[role="tablist"]')) {
        return;
      }
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
      <DialogContent
        // The close cross is in the header row with the other two actions,
        // not the dialog's own, which floated above them out of line.
        showCloseButton={false}
        data-maximized={maximized ? "" : undefined}
        className={cn(
          "grid-cols-[minmax(0,1fr)]",
          maximized
            ? "flex h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] flex-col sm:max-w-[calc(100vw-2rem)]"
            : "max-w-[92vw] sm:max-w-3xl",
        )}
      >
        {/* One header row: the name, then three icon buttons of one size,
            Download, maximize and close, on a single line. */}
        <div className="flex items-center gap-1">
          <DialogTitle className="min-w-0 flex-1 truncate text-sm">
            {current.name}
          </DialogTitle>
          {/* Same-origin, so `download` is honoured and saves under the real
              filename. The endpoint serves inline, which is right for the
              preview beside it and useless when you actually want the file. */}
          <Button
            variant="minimal"
            intent="none"
            size="icon-sm"
            nativeButton={false}
            aria-label={tr("common.download")}
            title={tr("common.download")}
            render={
              <a
                href={current.src ?? `/api/files/${current.fileId}`}
                download={current.name}
              />
            }
          >
            <Download className="size-4" />
          </Button>
          <Button
            type="button"
            variant="minimal"
            intent="none"
            size="icon-sm"
            data-testid="attachment-maximize"
            aria-pressed={maximized}
            aria-label={tr(
              maximized ? "attachments.restore" : "attachments.maximize",
            )}
            title={tr(
              maximized ? "attachments.restore" : "attachments.maximize",
            )}
            onClick={() => setMaximized((value) => !value)}
          >
            {maximized ? (
              <Minimize2 className="size-4" />
            ) : (
              <Maximize2 className="size-4" />
            )}
          </Button>
          <DialogClose
            render={
              <Button
                variant="minimal"
                intent="none"
                size="icon-sm"
                aria-label={tr("common.close")}
                title={tr("common.close")}
              />
            }
          >
            <X className="size-4" />
          </DialogClose>
        </div>

        {isHtml && (
          <Segmented
            size="sm"
            className="self-start"
            value={tab}
            onChange={(value) => setTab(value === "code" ? "code" : "preview")}
            options={[
              { value: "preview", label: tr("attachments.tab.preview") },
              { value: "code", label: tr("attachments.tab.code") },
            ]}
          />
        )}

        <div
          className={cn(
            "flex min-w-0 items-center justify-center",
            maximized && "min-h-0 flex-1",
          )}
        >
          {preview.kind === "video" && (
            // `key`: a new file is a new element, so the carousel never
            // plays the previous video's stream under the next one's name.
            // oxlint-disable-next-line jsx-a11y/media-has-caption -- a file someone attached: it carries no caption track to offer
            <video
              key={current.fileId}
              src={current.src ?? `/api/files/${current.fileId}`}
              controls
              playsInline
              preload="metadata"
              data-testid="attachment-video"
              className={cn(
                "w-auto max-w-full rounded-md bg-black",
                maximized ? "h-full max-h-full" : "max-h-[70vh]",
              )}
            />
          )}

          {preview.kind === "image" && (
            <img
              src={current.src ?? `/api/files/${current.fileId}`}
              alt=""
              className={cn(
                "w-auto max-w-full rounded-md object-contain",
                maximized ? "h-full max-h-full" : "max-h-[70vh]",
              )}
            />
          )}

          {isTextual && (
            <div
              data-testid="attachment-text-preview"
              className={cn(
                preview.kind === "markdown"
                  ? "w-full min-w-0 overflow-auto rounded-md"
                  : "w-full min-w-0 [&_code]:w-max [&_code]:min-w-full [&_code]:overflow-x-visible [&_pre]:my-0",
                // Maximized, a code file's `<pre>` fills the dialog (through
                // `MarkdownView`'s root), keeping its own scrollbars in view;
                // a markdown file scrolls as one page.
                preview.kind === "markdown"
                  ? maximized
                    ? "h-full"
                    : "max-h-[70vh]"
                  : maximized
                    ? "h-full [&_pre]:h-full [&_pre]:max-h-full [&>div]:h-full"
                    : "[&_pre]:max-h-[70vh]",
              )}
            >
              {tooLarge ? (
                <p className="text-muted-foreground p-4 text-sm italic">
                  {tr("attachments.previewTooLarge")}
                </p>
              ) : text === null ? (
                <p className="text-muted-foreground p-4 text-sm italic">
                  {tr("loading")}
                </p>
              ) : isHtml && tab === "preview" ? (
                <AttachmentHtmlPreview
                  html={text}
                  title={current.name}
                  fill={maximized}
                />
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
              variant="solid"
              intent="none"
              size="icon-sm"
              aria-label={tr("common.previous")}
              onClick={() => go(-1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <p className="text-muted-foreground text-xs">
              {tr("attachments.position", {
                args: [String(index + 1), String(count)],
              })}
            </p>
            <Button
              type="button"
              variant="solid"
              intent="none"
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

export default AttachmentLightbox;
