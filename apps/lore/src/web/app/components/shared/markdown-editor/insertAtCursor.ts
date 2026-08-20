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

/**
 * Wrap an uploaded reference as a markdown image.
 *
 * The upload handlers return a bare reference (`/api/files/<uuid>` for a
 * quest, `assets/<name>` for a folio) and that is what used to be inserted,
 * so pasting a screenshot dropped a naked URL into the prose instead of the
 * picture.
 *
 * The alt text is the filename with the four characters that would end the
 * markdown early stripped out: an unescaped `]` in a name truncates the alt,
 * and a `)` truncates the link.
 */
export const imageMarkdown = (name: string, reference: string): string =>
  `![${name.replace(/[[\]()]/g, "")}](${reference})`;
