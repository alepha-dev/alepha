import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { buildInsertion } from "./insertAtCursor.ts";

/**
 * Asserted against a bare `EditorState` for the same reason as
 * `codeMirrorSetup.browser.spec.ts`: building a transaction needs no layout,
 * dispatching one into a live view does.
 */
describe("buildInsertion", () => {
  it("inserts at the caret, not at the start of the document", () => {
    const state = EditorState.create({
      doc: "hello world",
      selection: { anchor: 5 },
    });

    const spec = buildInsertion(state, "!");

    expect(spec.changes.from).toBe(5);
    expect(spec.changes.to).toBe(5);
    expect(spec.changes.insert).toBe("!");
  });

  it("leaves the caret after the inserted text", () => {
    const state = EditorState.create({ doc: "" });

    expect(buildInsertion(state, "xyz").selection.anchor).toBe(3);
  });

  it("replaces a selection rather than inserting beside it", () => {
    const state = EditorState.create({
      doc: "before after",
      selection: { anchor: 0, head: 6 },
    });

    const spec = buildInsertion(state, "![a](assets/a.webp)");

    expect(spec.changes.from).toBe(0);
    expect(spec.changes.to).toBe(6);
    expect(spec.changes.insert).toBe("![a](assets/a.webp)");
  });

  it("produces a spec that actually applies to the document", () => {
    // The assertions above describe the spec; this one proves it means what
    // it says once CodeMirror applies it.
    const state = EditorState.create({
      doc: "see: ",
      selection: { anchor: 5 },
    });

    const next = state.update(
      buildInsertion(state, "![x](assets/x.webp)"),
    ).state;

    expect(next.doc.toString()).toBe("see: ![x](assets/x.webp)");
    expect(next.selection.main.anchor).toBe(24);
  });
});
