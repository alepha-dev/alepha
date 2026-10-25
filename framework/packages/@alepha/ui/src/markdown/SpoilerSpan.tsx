import * as React from "react";

void React;

import { useState } from "react";

export interface SpoilerSpanProps {
  children?: React.ReactNode;
}

/**
 * A `||spoiler||`, hidden until the reader asks for it.
 *
 * ## ⚠️ It is not a security feature
 *
 * The text is in the DOM from the first paint - hidden by a colour, not by an
 * absence. It is also in the raw markdown, in a folio export, in `folio_get`
 * over MCP and in any search snippet. It hides a plot point from a reader's
 * eye and nothing more, and must never be described as a way to store a
 * secret.
 *
 * ## Reachable without a mouse
 *
 * `role="button"` with a `tabIndex`, Enter and Space, and an `aria-label`
 * naming what it is: a screen reader that met a bare `<span>` here would
 * simply read the hidden text aloud, which is not a failure of privacy (see
 * above) but is a failure to say that the author meant it to be covered.
 *
 * Once revealed it stays revealed. Re-hiding on blur would make the thing
 * unreadable with a keyboard, since moving on to read what is around it is
 * exactly what a reader does next.
 */
export const SpoilerSpan = (props: SpoilerSpanProps) => {
  const [revealed, setRevealed] = useState(false);

  if (revealed) {
    return (
      <span data-spoiler="revealed" className="rounded-[3px] px-0.5">
        {props.children}
      </span>
    );
  }

  return (
    <span
      data-spoiler="hidden"
      role="button"
      tabIndex={0}
      aria-expanded={false}
      aria-label="Hidden text, activate to reveal"
      className="rounded-[3px] px-0.5"
      onClick={() => setRevealed(true)}
      onKeyDown={(event) => {
        // Enter and Space, because `role="button"` promises both and a `span`
        // delivers neither on its own. `preventDefault` on Space stops the
        // page scrolling out from under the reader who just pressed it.
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setRevealed(true);
        }
      }}
    >
      {props.children}
    </span>
  );
};
