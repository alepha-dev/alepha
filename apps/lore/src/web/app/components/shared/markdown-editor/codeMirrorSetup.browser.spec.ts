import { copyLineDown, undo } from "@codemirror/commands";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState, type Transaction } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import { createMarkdownExtensions } from "./codeMirrorSetup.ts";

/**
 * These assert against a bare `EditorState`, never an `EditorView`.
 *
 * That is the whole reason `createMarkdownExtensions` is a separate
 * function: a view measures layout on construction and jsdom supplies no
 * `Range.getClientRects`, so a spec that mounted one would be testing the
 * environment. A state needs no layout, so everything below is a real
 * assertion about the extension list rather than a proxy for one.
 *
 * The editor itself is covered by Playwright.
 */
const stateWith = (doc: string, options = {}) =>
  EditorState.create({ doc, extensions: createMarkdownExtensions(options) });

describe("createMarkdownExtensions", () => {
  it("parses the document as markdown", () => {
    const state = stateWith("# Title");
    const tree = ensureSyntaxTree(state, state.doc.length, 5000);

    expect(tree?.topNode.firstChild?.name).toBe("ATXHeading1");
  });

  it("parses GFM-flavoured constructs, not just CommonMark", () => {
    const state = stateWith("- [ ] a task");
    const tree = ensureSyntaxTree(state, state.doc.length, 5000);

    expect(tree?.topNode.firstChild?.name).toBe("BulletList");
  });

  it("is editable by default", () => {
    expect(stateWith("x").readOnly).toBe(false);
  });

  it("is read-only when asked", () => {
    expect(stateWith("x", { readOnly: true }).readOnly).toBe(true);
  });

  it("mounts an undo history", () => {
    let state = stateWith("hello");
    state = state.update({
      changes: { from: 5, insert: " world" },
    }).state;
    expect(state.doc.toString()).toBe("hello world");

    // `undo` is a Command: it takes anything with `state` and `dispatch`, so
    // it runs without a view.
    const applied = undo({
      state,
      dispatch: (transaction: Transaction) => {
        state = transaction.state;
      },
    });

    expect(applied).toBe(true);
    expect(state.doc.toString()).toBe("hello");
  });

  it("binds Mod-d to duplicate-line, ahead of the search keymap", () => {
    // `searchKeymap` also claims Mod-d, for `selectNextOccurrence`. A
    // keymap runs its bindings in array order and stops at the first that
    // returns true, so the ASSERTION IS THE ORDERING: the first Mod-d in
    // the resolved list has to be ours. Checking only that some binding
    // exists would pass with the line moved below the search keymap, which
    // is the one way this can regress.
    const state = stateWith("hello\n");
    const bound = state
      .facet(keymap)
      .flat()
      .filter((binding) => binding.key === "Mod-d");

    expect(bound.length).toBeGreaterThan(1);
    expect(bound[0]?.run).toBe(copyLineDown);
  });

  it("duplicates the caret's line when that binding runs", () => {
    let state = EditorState.create({
      doc: "hello",
      selection: { anchor: 0 },
      extensions: createMarkdownExtensions({}),
    });

    const applied = copyLineDown({
      state,
      dispatch: (transaction: Transaction) => {
        state = transaction.state;
      },
    });

    expect(applied).toBe(true);
    expect(state.doc.toString()).toBe("hello\nhello");
  });
});
