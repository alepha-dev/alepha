import type { EditorState, TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/**
 * The transaction that puts `text` where the caret is, replacing whatever
 * is selected.
 *
 * Split from `insertAtCursor` so it can be tested against a bare
 * `EditorState` — building a transaction needs no layout, while dispatching
 * one into a live `EditorView` does, and jsdom supplies no layout.
 */
export const buildInsertion = (
  state: EditorState,
  text: string,
  // Narrower than `TransactionSpec` on both fields it sets. `TransactionSpec`
  // types `selection` as `EditorSelection | {anchor, head?}`, so a caller
  // reading `.selection.anchor` off the union does not typecheck — and the
  // caller that most wants to is the test.
): TransactionSpec & {
  changes: { from: number; to: number; insert: string };
  selection: { anchor: number };
} => {
  const range = state.selection.main;
  return {
    changes: { from: range.from, to: range.to, insert: text },
    selection: { anchor: range.from + text.length },
  };
};

/**
 * Insert markdown at the caret and keep focus in the editor.
 *
 * This is the whole of image support now: an upload resolves to an
 * `assets/<name>` reference and that TEXT is written into the document. No
 * `<img>` is ever produced — which is what makes an exported folio a copy
 * rather than a transform, and what let `rehypeSafeImg` (the reader-side
 * plugin that existed solely to render the old editor's resized-image HTML)
 * be deleted from `@alepha/ui`.
 */
export const insertAtCursor = (view: EditorView, text: string): void => {
  view.dispatch(buildInsertion(view.state, text));
  view.focus();
};
