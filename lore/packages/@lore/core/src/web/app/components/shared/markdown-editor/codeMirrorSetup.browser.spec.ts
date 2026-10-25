import { acceptCompletion } from "@codemirror/autocomplete";
import {
  copyLineDown,
  indentLess,
  indentMore,
  undo,
} from "@codemirror/commands";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState, type Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
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

  it("gives Tab to the completion picker first, then to indent", () => {
    // `completionKeymap` puts accept on ENTER and claims no Tab at all, so
    // mounting `indentWithTab` alone would indent the line under an open
    // `[[` wiki-link picker. `acceptCompletion` returns false when nothing
    // is open, which is what lets the two share the key — but only in this
    // order.
    const state = stateWith("hello");
    const bound = state
      .facet(keymap)
      .flat()
      .filter((binding) => binding.key === "Tab");

    expect(bound[0]?.run).toBe(acceptCompletion);
    expect(bound[1]?.run).toBe(indentMore);
  });

  it("dedents on Shift-Tab", () => {
    // `indentWithTab` carries its own `shift`, so this is not a second
    // binding to add — it is the half that would be lost by writing
    // `{ key: "Tab", run: indentMore }` by hand instead.
    const state = stateWith("hello");
    const tab = state
      .facet(keymap)
      .flat()
      .find((binding) => binding.key === "Tab" && binding.shift);

    expect(tab?.shift).toBe(indentLess);
  });

  it("indents and dedents the selected line", () => {
    let state = EditorState.create({
      doc: "hello",
      selection: { anchor: 0 },
      extensions: createMarkdownExtensions({}),
    });
    const dispatch = (transaction: Transaction) => {
      state = transaction.state;
    };

    expect(indentMore({ state, dispatch })).toBe(true);
    expect(state.doc.toString()).toBe("  hello");

    expect(indentLess({ state, dispatch })).toBe(true);
    expect(state.doc.toString()).toBe("hello");
  });

  it("keeps the tab-focus escape hatch reachable", () => {
    // Nothing in the extension list binds Escape to arm tab-focus mode:
    // `@codemirror/view`'s own keydown handler already does it, and a
    // binding of ours would return true and swallow Escape from the drawer
    // this editor is mounted inside.
    //
    // So what has to be pinned is the API that hatch rides on. Without it,
    // `indentWithTab` makes this surface a keyboard trap, and a CodeMirror
    // upgrade that renamed or dropped `setTabFocusMode` would take the way
    // out with it in complete silence — no type error, no failing render.
    expect(typeof EditorView.prototype.setTabFocusMode).toBe("function");
  });
});
