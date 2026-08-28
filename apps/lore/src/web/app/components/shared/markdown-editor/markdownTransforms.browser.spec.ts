import { parseFlowchart } from "@alepha/ui/components/markdown-view/diagram/flowchartParser.ts";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import {
  DIAGRAM_BLOCK,
  insertBlock,
  TABLE_BLOCK,
  toggleFencedCode,
  toggleInlineMarker,
  toggleLinePrefix,
} from "./markdownTransforms.ts";

/**
 * Every case applies the returned spec and asserts on the resulting
 * DOCUMENT, not on the spec's fields. A transform that produces a
 * plausible-looking `changes` object but the wrong text is exactly the bug
 * these need to catch, and only applying it proves the difference.
 */
const at = (doc: string, from: number, to = from) =>
  EditorState.create({ doc, selection: { anchor: from, head: to } });

const applied = (state: EditorState, spec: ReturnType<typeof insertBlock>) =>
  state.update(spec).state.doc.toString();

describe("toggleInlineMarker", () => {
  it("wraps a selection", () => {
    const s = at("make me bold", 8, 12);
    expect(applied(s, toggleInlineMarker(s, "**"))).toBe("make me **bold**");
  });

  it("leaves the wrapped text selected so a second click un-wraps it", () => {
    const s = at("make me bold", 8, 12);
    const next = s.update(toggleInlineMarker(s, "**")).state;
    expect(
      next.doc.sliceString(next.selection.main.from, next.selection.main.to),
    ).toBe("bold");
  });

  it("unwraps when the markers are inside the selection", () => {
    const s = at("a **bold** b", 2, 10);
    expect(applied(s, toggleInlineMarker(s, "**"))).toBe("a bold b");
  });

  it("unwraps when the markers are OUTSIDE the selection", () => {
    // Double-clicking a word selects the word, never its markers — this is
    // the common path, and the one a naive implementation misses.
    const s = at("a **bold** b", 4, 8);
    expect(applied(s, toggleInlineMarker(s, "**"))).toBe("a bold b");
  });

  it("puts the caret between the markers on an empty selection", () => {
    const s = at("", 0);
    const next = s.update(toggleInlineMarker(s, "**")).state;
    expect(next.doc.toString()).toBe("****");
    expect(next.selection.main.anchor).toBe(2);
  });

  it("works for italic and inline code too", () => {
    const i = at("word", 0, 4);
    expect(applied(i, toggleInlineMarker(i, "*"))).toBe("*word*");
    const c = at("word", 0, 4);
    expect(applied(c, toggleInlineMarker(c, "`"))).toBe("`word`");
  });

  it("does not mistake bold for italic when unwrapping", () => {
    // `*` is a prefix of `**`; unwrapping italic on `**bold**` must not
    // strip one asterisk from each side and leave `*bold*`.
    const s = at("**bold**", 2, 6);
    expect(applied(s, toggleInlineMarker(s, "*"))).toBe(
      "**|bold|**".replace(/\|/g, "*"),
    );
  });
});

describe("toggleLinePrefix", () => {
  it("adds a heading prefix", () => {
    const s = at("Title", 0);
    expect(applied(s, toggleLinePrefix(s, "# "))).toBe("# Title");
  });

  it("removes the prefix when it is already exactly that one", () => {
    const s = at("# Title", 0);
    expect(applied(s, toggleLinePrefix(s, "# "))).toBe("Title");
  });

  it("REPLACES a heading level rather than stacking", () => {
    const s = at("# Title", 0);
    expect(applied(s, toggleLinePrefix(s, "## "))).toBe("## Title");
  });

  it("applies across every line the selection touches", () => {
    const s = at("one\ntwo\nthree", 0, 13);
    expect(applied(s, toggleLinePrefix(s, "- "))).toBe("- one\n- two\n- three");
  });

  it("only removes when EVERY touched line already has the prefix", () => {
    const s = at("- one\ntwo", 0, 9);
    expect(applied(s, toggleLinePrefix(s, "- "))).toBe(
      "- - one\n- two".replace("- - ", "- "),
    );
  });
});

describe("insertBlock", () => {
  it("inserts a table into an empty document without a leading blank line", () => {
    const s = at("", 0);
    expect(applied(s, insertBlock(s, TABLE_BLOCK))).toBe(`${TABLE_BLOCK}\n`);
  });

  it("separates the block from surrounding prose", () => {
    const s = at("before", 6);
    expect(applied(s, insertBlock(s, "---"))).toBe("before\n\n---\n");
  });

  it("leaves the caret after the inserted block", () => {
    const s = at("before", 6);
    const next = s.update(insertBlock(s, "---")).state;
    expect(next.selection.main.anchor).toBe(next.doc.length);
  });

  it("never splits the line it was invoked from", () => {
    const s = at("hello world", 5);
    expect(applied(s, insertBlock(s, "---"))).toBe("hello world\n\n---\n");
  });
});

describe("DIAGRAM_BLOCK", () => {
  it("is a mermaid fence", () => {
    expect(DIAGRAM_BLOCK.startsWith("```mermaid\n")).toBe(true);
    expect(DIAGRAM_BLOCK.endsWith("```")).toBe(true);
  });

  it("is a starter our own parser can actually read", () => {
    // A starter that does not render is worse than no starter: the author
    // inserts it, sees a grey fence, and concludes diagrams do not work.
    const source = /```mermaid\n([\s\S]*?)```/.exec(DIAGRAM_BLOCK);
    expect(parseFlowchart(source?.[1] ?? "")).toBeDefined();
  });

  it("inserts into an empty document as its own block", () => {
    const state = at("", 0);
    expect(applied(state, insertBlock(state, DIAGRAM_BLOCK))).toContain(
      "flowchart TD",
    );
  });
});

describe("toggleFencedCode", () => {
  it("wraps every line the selection touches", () => {
    const doc = "one\ntwo\nthree";
    // Selection starts mid-first-line and ends mid-last, which is what a
    // drag-select actually produces - the fence still has to take whole
    // lines or the markers land inside the text.
    const s = at(doc, 1, 11);
    expect(applied(s, toggleFencedCode(s))).toBe("```\none\ntwo\nthree\n```");
  });

  it("wraps a single selected line", () => {
    const s = at("hello", 0, 5);
    expect(applied(s, toggleFencedCode(s))).toBe("```\nhello\n```");
  });

  it("keeps the wrapped text selected so the next command acts on it", () => {
    const s = at("one\ntwo", 0, 7);
    const next = s.update(toggleFencedCode(s)).state;
    expect(
      next.doc.sliceString(next.selection.main.from, next.selection.main.to),
    ).toBe("one\ntwo");
  });

  it("unwraps a fence that is already there", () => {
    const doc = "```\none\ntwo\n```";
    const s = at(doc, 0, doc.length);
    expect(applied(s, toggleFencedCode(s))).toBe("one\ntwo");
  });

  it("unwraps when the selection is only the fenced CONTENT", () => {
    // Selecting the code without its markers is the commonest way to ask
    // for this, exactly as with the inline toggle.
    const doc = "```\none\ntwo\n```";
    expect(applied(at(doc, 4, 11), toggleFencedCode(at(doc, 4, 11)))).toBe(
      "one\ntwo",
    );
  });

  it("preserves the info string when unwrapping is not asked for", () => {
    const doc = "```tsx\nconst a = 1;\n```";
    const s = at(doc, 0, doc.length);
    expect(applied(s, toggleFencedCode(s))).toBe("const a = 1;");
  });

  it("inserts an empty fence when nothing is selected", () => {
    const s = at("", 0);
    expect(applied(s, toggleFencedCode(s))).toBe("```\n\n```");
  });

  it("puts the caret inside the fence when nothing is selected", () => {
    const s = at("", 0);
    const next = s.update(toggleFencedCode(s)).state;
    // Right after the opening "```\n".
    expect(next.selection.main.anchor).toBe(4);
  });
});
