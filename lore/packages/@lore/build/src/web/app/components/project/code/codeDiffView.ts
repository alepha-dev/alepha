import { type HighlightToken, highlightLines } from "@alepha/ui/markdown";
import type { Infer } from "alepha";

import type { codeDiffHunkSchema } from "../../../../../api/schemas/codeDiffHunkSchema.ts";

type Hunk = Infer<typeof codeDiffHunkSchema>;

/**
 * A hunk's lines highlighted (#Q4135): each side's lines (context and
 * deletions, context and additions) highlighted as one text, so a comment or
 * a string that spans lines keeps its colour, then read back line by line.
 */
export const highlightHunk = (
  hunk: Hunk,
  language: string | undefined,
): HighlightToken[][] => {
  const oldIndex: number[] = [];
  const newIndex: number[] = [];
  const oldText: string[] = [];
  const newText: string[] = [];
  hunk.lines.forEach((line, index) => {
    if (line.kind !== "add") {
      oldIndex.push(index);
      oldText.push(line.text);
    }
    if (line.kind !== "del") {
      newIndex.push(index);
      newText.push(line.text);
    }
  });
  const out: HighlightToken[][] = hunk.lines.map((line) => [
    { value: line.text },
  ]);
  const oldTokens = highlightLines(oldText.join("\n"), language);
  const newTokens = highlightLines(newText.join("\n"), language);
  oldIndex.forEach((index, at) => {
    if (hunk.lines[index]!.kind === "del") out[index] = oldTokens[at] ?? [];
  });
  newIndex.forEach((index, at) => {
    out[index] = newTokens[at] ?? [];
  });
  return out;
};

/**
 * The unchanged stretch before hunk `index` (or after the last one, at
 * `hunks.length`), in new-side line numbers, and how far the old side is
 * behind or ahead in it: undefined when there is none.
 */
export const gapBefore = (
  hunks: Hunk[],
  index: number,
  newLineCount: number | undefined,
): { start: number; end: number; delta: number } | undefined => {
  const previous = hunks[index - 1];
  const next = hunks[index];
  const start = previous ? previous.newStart + previous.newLines : 1;
  const end = next ? next.newStart - 1 : (newLineCount ?? 0);
  if (end < start) return undefined;
  const delta = previous
    ? previous.newStart +
      previous.newLines -
      (previous.oldStart + previous.oldLines)
    : next
      ? next.newStart - next.oldStart
      : 0;
  return { start, end, delta };
};
