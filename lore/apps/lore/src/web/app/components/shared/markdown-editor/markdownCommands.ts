import type { EditorView } from "@codemirror/view";

import {
  DIAGRAM_BLOCK,
  insertBlock,
  TABLE_BLOCK,
  toggleFencedCode,
  toggleInlineMarker,
  toggleLinePrefix,
} from "./markdownTransforms.ts";

/**
 * The formatting actions the menubar and the selection popup expose, keyed
 * by the id the menubar model uses.
 *
 * Thin wrappers over `markdownTransforms` — they dispatch and refocus, and
 * hold no logic of their own so the tested transforms stay the single
 * definition of what each edit means.
 *
 * These exist without any editor "realm": the previous editor could only
 * publish Bold from inside a Lexical context, which is why the whole
 * portal/registration apparatus existed. A string edit needs none of it.
 */
export type MarkdownCommandId =
  | "edit.bold"
  | "edit.italic"
  | "edit.code"
  | "insert.heading1"
  | "insert.heading2"
  | "insert.heading3"
  | "insert.bulletList"
  | "insert.numberedList"
  | "insert.quote"
  | "insert.table"
  | "insert.codeBlock"
  | "insert.diagram"
  | "insert.divider";

export const markdownCommands: Record<
  MarkdownCommandId,
  (view: EditorView) => void
> = {
  "edit.bold": (v) => apply(v, toggleInlineMarker(v.state, "**")),
  "edit.italic": (v) => apply(v, toggleInlineMarker(v.state, "*")),
  "edit.code": (v) => apply(v, toggleInlineMarker(v.state, "`")),
  "insert.heading1": (v) => apply(v, toggleLinePrefix(v.state, "# ")),
  "insert.heading2": (v) => apply(v, toggleLinePrefix(v.state, "## ")),
  "insert.heading3": (v) => apply(v, toggleLinePrefix(v.state, "### ")),
  "insert.bulletList": (v) => apply(v, toggleLinePrefix(v.state, "- ")),
  "insert.numberedList": (v) => apply(v, toggleLinePrefix(v.state, "1. ")),
  "insert.quote": (v) => apply(v, toggleLinePrefix(v.state, "> ")),
  "insert.table": (v) => apply(v, insertBlock(v.state, TABLE_BLOCK)),
  // NOT `insertBlock`: this one has to WRAP the selection. See
  // `toggleFencedCode` for what the old call got wrong.
  "insert.codeBlock": (v) => apply(v, toggleFencedCode(v.state)),
  "insert.diagram": (v) => apply(v, insertBlock(v.state, DIAGRAM_BLOCK)),
  "insert.divider": (v) => apply(v, insertBlock(v.state, "---")),
};

/**
 * Dispatch and return focus to the document.
 *
 * The refocus is not cosmetic: every caller is a button, and clicking one
 * moves focus out of the editor. Without this the caret the transform just
 * positioned belongs to a blurred element and the next keystroke goes
 * nowhere.
 */
const apply = (
  view: EditorView,
  spec: Parameters<EditorView["dispatch"]>[0],
): void => {
  view.dispatch(spec);
  view.focus();
};
