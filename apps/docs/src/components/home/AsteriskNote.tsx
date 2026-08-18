import { useState } from "react";

export interface AsteriskNoteProps {
  children: React.ReactNode;
}

/**
 * The accent asterisk with a hover note, as used after "Everything included."
 * on the live site. Kept as a component because it now appears on a heading
 * rather than inline in a paragraph, and the old version carried its whole
 * tooltip in inline styles.
 */
const AsteriskNote = (props: AsteriskNoteProps) => {
  const [open, setOpen] = useState(false);

  return (
    <span
      className="asterisk-note"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="asterisk-note-mark"
        aria-expanded={open}
        aria-label="Footnote"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        *
      </button>
      {open ? (
        <span className="asterisk-note-tip" role="tooltip">
          {props.children}
        </span>
      ) : null}
    </span>
  );
};

export default AsteriskNote;
