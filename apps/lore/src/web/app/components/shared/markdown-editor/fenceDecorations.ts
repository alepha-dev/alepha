import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

/**
 * Line decorations that draw a fenced code block as a BLOCK, rather than as
 * prose that happens to be coloured.
 *
 * This is the smallest possible piece of the live-preview work, and it is
 * here first because the reading face made it load-bearing rather than
 * cosmetic: the folio document sets `.cm-content` in Literata, so without a
 * mono face of its own a ```tsx fence renders in a serif and its indentation
 * stops lining up.
 *
 * Line decorations, not mark decorations, on purpose. A mark only covers the
 * tokens the grammar produced, so leading indentation and blank lines inside
 * the fence would keep the prose face and the block background would be
 * ragged. A line decoration covers the whole row.
 */
const CODE_LINE = Decoration.line({ class: "lore-cm-code-line" });
const CODE_FIRST = Decoration.line({
  class: "lore-cm-code-line lore-cm-code-first",
});
const CODE_LAST = Decoration.line({
  class: "lore-cm-code-line lore-cm-code-last",
});

/**
 * Collect the line numbers covered by every `FencedCode` node in view.
 *
 * A Set keyed by line number rather than a list of ranges: two fences cannot
 * overlap, but a fence CAN start before the visible range and end after it,
 * so the same line is reachable from more than one `visibleRanges` pass.
 * `RangeSetBuilder` rejects anything added out of order or twice, which is
 * why the numbers are gathered first and sorted once at the end.
 */
const fencedLines = (
  view: EditorView,
): { first: Set<number>; last: Set<number>; all: Set<number> } => {
  const all = new Set<number>();
  const first = new Set<number>();
  const last = new Set<number>();
  const doc = view.state.doc;

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== "FencedCode") return;
        // Clamped to the document: an unterminated fence at the end of the
        // buffer reports a `to` one past the last position while the author
        // is still typing it.
        const start = doc.lineAt(Math.min(node.from, doc.length)).number;
        const end = doc.lineAt(Math.min(node.to, doc.length)).number;
        first.add(start);
        last.add(end);
        for (let n = start; n <= end; n++) all.add(n);
      },
    });
  }

  return { first, last, all };
};

const build = (view: EditorView): DecorationSet => {
  const builder = new RangeSetBuilder<Decoration>();
  const { first, last, all } = fencedLines(view);
  const doc = view.state.doc;

  for (const n of [...all].sort((a, b) => a - b)) {
    // A one-line fence is both ends at once; it takes the rounded top since
    // a block with only a rounded bottom reads as a rendering fault.
    const deco = first.has(n)
      ? CODE_FIRST
      : last.has(n)
        ? CODE_LAST
        : CODE_LINE;
    builder.add(doc.line(n).from, doc.line(n).from, deco);
  }

  return builder.finish();
};

/**
 * Recomputed on document and viewport changes only.
 *
 * Deliberately NOT on selection: nothing here depends on where the caret is.
 * When the syntax-hiding half of live preview lands it will need
 * `update.selectionSet` as well, since that is the whole mechanism - markers
 * hide on the lines the cursor is not on.
 */
export const fenceBlockHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = build(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = build(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
