import type { ReactNode } from "react";

import { highlightRanges } from "./highlightRanges.ts";
import { cn } from "./utils.ts";

export interface HighlightProps {
  /**
   * The text to draw.
   */
  text: string;
  /**
   * What to mark in it. Each word is marked on its own, ignoring case and
   * accents (see `highlightRanges`). Empty or absent marks nothing, and the
   * text is drawn as it is.
   */
  query?: string;
  /**
   * Classes for each `<mark>`, merged over the default tint.
   */
  className?: string;
}

/**
 * `text`, with what a search matched in it wrapped in `<mark>`: the reader
 * sees WHY a row answered their search, which a list of names alone does not
 * say once the match is in the middle of one.
 *
 * ```tsx
 * <Highlight text={player.name} query={search} />
 * ```
 *
 * Inside a `DataTable`, a cell receives the table's search as its second
 * argument, so a column marks it with no state of its own:
 *
 * ```tsx
 * columns={{
 *   name: {
 *     label: "Name",
 *     cell: (row, ctx) => (
 *       <Highlight text={row.name} query={ctx?.search} />
 *     ),
 *   },
 * }}
 * ```
 *
 * A light tint of the primary colour, with the text keeping its own colour:
 * the browser's default yellow `<mark>` ignores the theme, and a solid
 * primary fill under body text is unreadable. `data-slot="highlight"` to
 * restyle it globally.
 */
export const Highlight = (props: HighlightProps) => {
  const ranges = highlightRanges(props.text, props.query);
  if (ranges.length === 0) return props.text;

  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) parts.push(props.text.slice(cursor, start));
    parts.push(
      <mark
        key={start}
        data-slot="highlight"
        className={cn(
          "bg-primary/20 rounded-[2px] text-inherit",
          props.className,
        )}
      >
        {props.text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  if (cursor < props.text.length) parts.push(props.text.slice(cursor));
  return parts;
};
