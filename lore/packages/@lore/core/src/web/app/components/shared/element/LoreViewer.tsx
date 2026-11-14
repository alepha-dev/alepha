import { MarkdownView } from "@alepha/ui/markdown";
import { type MouseEvent, useState } from "react";

import AttachmentLightbox, {
  type PreviewableAttachment,
} from "../AttachmentLightbox.tsx";
import type { ElementRef } from "./elementRef.ts";
import { useElementLinks } from "./useElementLinks.ts";

export interface LoreViewerProps {
  element: ElementRef;
  /**
   * The element's stored markdown, exactly as saved.
   */
  content: string;
  /**
   * Extra classes for the prose root — a per-surface reading face.
   */
  className?: string;
}

/**
 * Read-only markdown for any element, with `[[…]]` resolved to real links.
 *
 * The reader half of the pair `LoreViewer` / `LoreEditor`. Every surface
 * that shows an element's body goes through this, so `[[#F42]]`,
 * `[[#Q12]]`, `[[#E3]]`, `[[#P120]]` and `[[#R12]]` all behave the same
 * whether the reader is looking at a folio, a quest or an epic — they did
 * not before, and the epic description rendered raw `[[…]]` tokens as
 * literal text.
 *
 * Renders nothing for empty content rather than an empty `MarkdownView`;
 * callers own their own "no description yet" copy, which differs per
 * surface.
 */
const LoreViewer = (props: LoreViewerProps) => {
  const { rendered } = useElementLinks(props.element, props.content ?? "");

  const [zoom, setZoom] = useState<{
    items: PreviewableAttachment[];
    openId: string;
  } | null>(null);

  if (!props.content) return null;

  // Click an image to see it full size (#Q3604), through the same lightbox
  // as attachments, paging every image of this body. Delegated: the images
  // are the markdown's, and an image inside a link keeps the link.
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLImageElement) || target.closest("a")) return;
    const images = [...event.currentTarget.querySelectorAll("img")].filter(
      (img) => !img.closest("a") && img.src,
    );
    const items = images.map((img, index) => ({
      fileId: `${index}:${img.src}`,
      name: img.alt || img.src.split("/").pop() || "",
      mimeType: "image/*",
      src: img.src,
    }));
    const at = images.indexOf(target);
    if (at < 0) return;
    event.preventDefault();
    setZoom({ items, openId: items[at].fileId });
  };

  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- delegation for the images the markdown renders, which carry no handler of their own; the lightbox it opens takes the keyboard
    <div onClick={onClick} className="[&_img]:cursor-zoom-in">
      <MarkdownView content={rendered} className={props.className} />
      <AttachmentLightbox
        items={zoom?.items ?? []}
        openId={zoom?.openId ?? null}
        onOpenChange={(open) => {
          if (!open) setZoom(null);
        }}
      />
    </div>
  );
};

export default LoreViewer;
