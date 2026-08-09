import { useI18n } from "alepha/react/i18n";
import { type ReactElement, useLayoutEffect, useRef } from "react";
import type { I18n } from "../../../../services/I18n.ts";

export interface FolioTitleFieldProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/**
 * The folio title, styled as document text rather than a form control — a
 * bare field with the serif face and no chrome, matching the design's "this
 * is a page, not a form" intent.
 *
 * A `<textarea>`, not an `<input>`: an input is single-line by definition
 * and can only scroll horizontally, so at this type size any real title
 * was cut off at the right edge of the 812px column with no visible end.
 * The value stays one line of *text* — Enter is swallowed and pasted
 * newlines are folded to spaces — it is only allowed to wrap onto several
 * visual lines.
 */
const FolioTitleField = (props: FolioTitleFieldProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const ref = useRef<HTMLTextAreaElement>(null);

  // `field-sizing: content` would do this in CSS, but it is not in every
  // engine we support yet. Resetting to `auto` first is load-bearing:
  // `scrollHeight` never reports less than the current height, so without
  // it the field grows with the title and never shrinks back.
  //
  // The value is not the only thing that changes the line count — so does
  // the column, every time a pane opens, closes or gets dragged. A height
  // computed once for the old width clips the moment the text needs another
  // line, which is the very bug this field exists to fix. Hence the
  // observer, and hence it watches the PARENT: observing the field itself
  // would feed back into the height this effect writes.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    sync();
    const parent = el.parentElement;
    if (!parent || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(sync);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [props.value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={props.value}
      disabled={props.disabled}
      // A title is a single-line string on save whatever the user pastes
      // into it — folding here rather than at save time keeps what is on
      // screen and what is stored the same thing.
      onChange={(e) =>
        props.onChange(e.target.value.replace(/\s*\r?\n\s*/g, " "))
      }
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        // Enter leaves the title for the body, the way it would in any
        // document — scoped to this document's own editor rather than the
        // first `contenteditable` on the page, since the inspector and the
        // tree can carry their own.
        e.currentTarget
          .closest("[data-slot='folio-document']")
          ?.querySelector<HTMLElement>('[contenteditable="true"]')
          ?.focus();
      }}
      placeholder={String(tr("folios.title-placeholder"))}
      aria-label={String(tr("folios.editor.title-label"))}
      className="folio-prose placeholder:text-muted-foreground w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-4xl font-semibold leading-tight tracking-tight outline-none"
    />
  );
};

export default FolioTitleField;
