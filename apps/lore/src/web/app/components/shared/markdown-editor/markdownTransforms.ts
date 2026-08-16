import type { EditorState, TransactionSpec } from "@codemirror/state";

/**
 * The markdown edits the menubar and the selection popup both perform.
 *
 * Pure `(state) => TransactionSpec` rather than CodeMirror `Command`s so
 * they can be tested against a bare `EditorState` — a `Command` needs a
 * live view, and a view needs layout jsdom cannot supply. The thin
 * `Command` wrappers live in `markdownCommands.ts`.
 *
 * Every one of these is a STRING edit. That is the whole point of the raw
 * editor: what you see is what is stored, so "make this bold" is literally
 * "put `**` around it" and nothing reinterprets the document afterwards.
 */

/**
 * Wrap or unwrap the selection with an inline marker (`**`, `*`, `` ` ``).
 *
 * Toggling looks OUTSIDE the selection as well as inside it, so it works
 * whether the user selected `word` inside `**word**` or the whole `**word**`
 * — double-clicking a word selects the word, not its markers, and that is
 * the commonest way this gets invoked.
 */
export const toggleInlineMarker = (
  state: EditorState,
  marker: string,
): TransactionSpec => {
  const range = state.selection.main;
  const doc = state.doc;
  const selected = doc.sliceString(range.from, range.to);
  const len = marker.length;
  const char = marker[0];

  // ⚠️ `*` is a prefix of `**`. Without this guard, asking for ITALIC on
  // text that is already BOLD sees a `*` on each side, decides the text is
  // already italic, and strips one asterisk per side — turning `**bold**`
  // into `*bold*`, i.e. silently demoting bold to italic instead of
  // nesting. Both toggles below therefore refuse to treat a marker as
  // "mine" when it is part of a longer run of the same character.
  const isExactRun = (start: number, end: number): boolean =>
    doc.sliceString(Math.max(0, start - 1), start) !== char &&
    doc.sliceString(end, Math.min(doc.length, end + 1)) !== char;

  // Already wrapped, markers inside the selection: `**word**` selected.
  if (
    selected.length >= len * 2 &&
    selected.startsWith(marker) &&
    selected.endsWith(marker) &&
    selected[len] !== char &&
    selected[selected.length - len - 1] !== char
  ) {
    const inner = selected.slice(len, -len);
    return {
      changes: { from: range.from, to: range.to, insert: inner },
      selection: { anchor: range.from, head: range.from + inner.length },
    };
  }

  // Already wrapped, markers OUTSIDE the selection: `word` selected within
  // `**word**`. Widen the replacement to swallow the markers.
  const before = doc.sliceString(Math.max(0, range.from - len), range.from);
  const after = doc.sliceString(range.to, Math.min(doc.length, range.to + len));
  if (
    before === marker &&
    after === marker &&
    isExactRun(range.from - len, range.to + len)
  ) {
    return {
      changes: {
        from: range.from - len,
        to: range.to + len,
        insert: selected,
      },
      selection: {
        anchor: range.from - len,
        head: range.from - len + selected.length,
      },
    };
  }

  // Not wrapped — wrap it. With an empty selection this leaves the caret
  // between the markers so the next keystroke lands inside them.
  const insert = `${marker}${selected}${marker}`;
  return {
    changes: { from: range.from, to: range.to, insert },
    selection: selected
      ? { anchor: range.from + len, head: range.from + len + selected.length }
      : { anchor: range.from + len },
  };
};

/**
 * Toggle a line prefix (`# `, `> `, `- `) on every line the selection
 * touches.
 *
 * Heading levels REPLACE each other rather than stacking: applying `##` to
 * a line that is already `# ` gives `## `, not `## # `. Any existing prefix
 * from the same family is stripped first, which is what makes the menu
 * entries behave like a level picker instead of an accumulator.
 */
export const toggleLinePrefix = (
  state: EditorState,
  prefix: string,
): TransactionSpec => {
  const range = state.selection.main;
  const doc = state.doc;
  const firstLine = doc.lineAt(range.from);
  const lastLine = doc.lineAt(range.to);

  // Headings are a family: `#`, `##`, `###`… all occupy the same slot.
  const family = /^#+ /.test(prefix)
    ? /^#+ /
    : new RegExp(`^${escapeRegExp(prefix)}`);
  const lines: string[] = [];
  for (let n = firstLine.number; n <= lastLine.number; n++) {
    lines.push(doc.line(n).text);
  }

  // Remove when every touched line already has exactly this prefix.
  const allHave = lines.every((text) => text.startsWith(prefix));
  const next = lines
    .map((text) =>
      allHave
        ? text.slice(prefix.length)
        : `${prefix}${text.replace(family, "")}`,
    )
    .join("\n");

  return {
    changes: { from: firstLine.from, to: lastLine.to, insert: next },
    selection: { anchor: firstLine.from, head: firstLine.from + next.length },
  };
};

/**
 * Insert a block on lines of its own, leaving the caret after it.
 *
 * Blank lines are added only where the surrounding text needs them, so
 * inserting a table into an empty document does not open with a stray
 * newline.
 */
export const insertBlock = (
  state: EditorState,
  block: string,
): TransactionSpec => {
  const range = state.selection.main;
  const doc = state.doc;
  const line = doc.lineAt(range.from);
  // Anchor at the end of the current line unless it is empty — inserting
  // mid-word would split the word around the block.
  const at = line.text.trim() ? line.to : line.from;
  const needsLeading = at > 0;
  const needsTrailing = at < doc.length;
  const insert = `${needsLeading ? "\n\n" : ""}${block}${needsTrailing ? "\n\n" : "\n"}`;

  return {
    changes: { from: at, to: at, insert },
    selection: { anchor: at + insert.length },
  };
};

/**
 * A GitHub-flavoured table skeleton — the shape `remark-gfm` renders and the
 * one the reader already styles.
 */
export const TABLE_BLOCK = [
  "| Column | Column |",
  "| --- | --- |",
  "|  |  |",
].join("\n");

/**
 * Escape a string for use inside a `RegExp`.
 */
const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
