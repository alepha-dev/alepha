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
 * Wrap the selected lines in a fenced code block, or unwrap them if they
 * already are one.
 *
 * Replaces `insertBlock(state, "```\n\n```")` for the Code block action.
 * That call ignored the selection completely: it anchored at the end of the
 * line the selection STARTED on and pasted an empty fence after it, so
 * selecting ten lines and asking for a code block left all ten untouched
 * and dropped an empty fence next to them.
 *
 * Whole lines, always. A fence marker is only a fence at the start of a
 * line, so a selection that begins mid-word has to be widened or the
 * backticks land inside the text and render as literal characters.
 *
 * Unwrapping accepts either shape, matching `toggleInlineMarker`: the
 * fence with its markers selected, or just the code inside it. Selecting
 * the content without its markers is the commonest way to ask, because
 * that is what a drag through the visible code produces.
 */
export const toggleFencedCode = (state: EditorState): TransactionSpec => {
  const range = state.selection.main;
  const doc = state.doc;

  // Empty selection keeps the old behaviour: an empty fence with the caret
  // parked between the markers, ready to type into.
  if (range.empty) {
    const line = doc.lineAt(range.from);
    const at = line.text.trim() ? line.to : line.from;
    const lead = at > 0 ? "\n\n" : "";
    const insert = `${lead}\`\`\`\n\n\`\`\``;
    return {
      changes: { from: at, to: at, insert },
      // Past the leading blanks and the opening "```\n".
      selection: { anchor: at + lead.length + 4 },
    };
  }

  const firstLine = doc.lineAt(range.from);
  const lastLine = doc.lineAt(range.to);
  const from = firstLine.from;
  const to = lastLine.to;

  const lines: string[] = [];
  for (let n = firstLine.number; n <= lastLine.number; n++) {
    lines.push(doc.line(n).text);
  }

  // Already a fence with its markers inside the selection. The opening
  // marker may carry an info string (```tsx), which is dropped along with
  // it - unwrapping returns the code, and the language was a property of
  // the fence rather than of the code.
  if (
    lines.length >= 2 &&
    /^\s*```/.test(lines[0]) &&
    /^\s*```\s*$/.test(lines[lines.length - 1])
  ) {
    const inner = lines.slice(1, -1).join("\n");
    return {
      changes: { from, to, insert: inner },
      selection: { anchor: from, head: from + inner.length },
    };
  }

  // Already a fence with the markers just OUTSIDE the selection: the user
  // selected the code, not its backticks. Widen to swallow them.
  const above = firstLine.number > 1 ? doc.line(firstLine.number - 1) : null;
  const below =
    lastLine.number < doc.lines ? doc.line(lastLine.number + 1) : null;
  if (
    above &&
    below &&
    /^\s*```/.test(above.text) &&
    /^\s*```\s*$/.test(below.text)
  ) {
    const inner = lines.join("\n");
    return {
      changes: { from: above.from, to: below.to, insert: inner },
      selection: { anchor: above.from, head: above.from + inner.length },
    };
  }

  // Not fenced - fence it, and leave the CODE selected rather than the
  // whole block, so a follow-up command acts on what the user chose.
  const body = lines.join("\n");
  const insert = `\`\`\`\n${body}\n\`\`\``;
  return {
    changes: { from, to, insert },
    selection: { anchor: from + 4, head: from + 4 + body.length },
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
 * A mermaid `flowchart` starter.
 *
 * Deliberately small and deliberately RENDERABLE: `MarkdownView` draws this
 * exact fence as a diagram, so the author who inserts it sees a picture
 * rather than a grey block and learns the syntax by editing it. A starter
 * that does not render would teach the opposite lesson.
 *
 * `markdownTransforms.browser.spec.ts` feeds it to the real parser, so a
 * change here that breaks it goes red instead of shipping.
 */
export const DIAGRAM_BLOCK = [
  "```mermaid",
  "flowchart TD",
  "  A[Start] --> B{Decision}",
  "  B -->|yes| C[Done]",
  "  B -->|no| A",
  "```",
].join("\n");

/**
 * Escape a string for use inside a `RegExp`.
 */
const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
