import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import type { WikiLinkSuggestion } from "../../folios/editor/wikilink/wikiLinkSuggestion.ts";
import { createWikiLinkCompletion } from "./wikiLinkCompletion.ts";

const suggestions: WikiLinkSuggestion[] = [
  {
    key: "folio:1",
    kind: "folio",
    token: "#F2",
    label: "Lore vocabulary",
    hint: "#F2",
  },
  {
    key: "folio:2",
    kind: "folio",
    token: "#F7",
    label: "Deploy runbook",
    hint: "#F7",
  },
  {
    key: "quest:19",
    kind: "quest",
    token: "#Q19",
    label: "Fix the tree",
    hint: "#Q19",
  },
];

/**
 * A real `CompletionContext` over a real `EditorState`, with the cursor at
 * the end of `doc`. Neither needs a view, so nothing here is a stub — the
 * source is exercised through the same API CodeMirror calls it with.
 */
const contextAt = (doc: string, explicit = false) =>
  new CompletionContext(
    EditorState.create({ doc, selection: { anchor: doc.length } }),
    doc.length,
    explicit,
  );

describe("createWikiLinkCompletion", () => {
  const source = createWikiLinkCompletion(() => suggestions);

  it("offers nothing when the cursor is not after [[", () => {
    expect(source(contextAt("plain prose "))).toBeNull();
  });

  it("offers everything right after [[", () => {
    expect(source(contextAt("see [["))?.options).toHaveLength(3);
  });

  it("filters on the typed query, case-insensitively", () => {
    const result = source(contextAt("see [[depl"));

    expect(result?.options.map((o) => o.label)).toEqual(["Deploy runbook"]);
  });

  it("matches a quest by its typed token as well as its label", () => {
    const result = source(contextAt("see [[#q19"));

    expect(result?.options.map((o) => o.label)).toEqual(["Fix the tree"]);
  });

  it("applies the typed token and closes the brackets", () => {
    const result = source(contextAt("see [[depl"));

    expect(result?.options[0].apply).toBe("#F7]]");
  });

  it("anchors the replacement after the opening brackets", () => {
    // `see [[` is 6 characters, so the query starts at 6 and the brackets
    // themselves are never replaced.
    expect(source(contextAt("see [[depl"))?.from).toBe(6);
  });

  it("offers nothing when the query matches nothing", () => {
    expect(source(contextAt("see [[zzzz"))).toBeNull();
  });

  it("does not reopen over an already-closed reference", () => {
    // The caret sits after `]]`. Without the `[^\]\n]*` bound in the match
    // pattern this would still look like an open token and the picker would
    // pop up over finished text.
    expect(source(contextAt("see [[Deploy runbook]]"))).toBeNull();
  });

  it("does not cross a newline", () => {
    expect(source(contextAt("see [[\nnext line"))).toBeNull();
  });

  it("caps the list at eight entries", () => {
    const many: WikiLinkSuggestion[] = Array.from({ length: 30 }, (_, i) => ({
      key: `folio:${i}`,
      kind: "folio" as const,
      token: `Folio ${i}`,
      label: `Folio ${i}`,
    }));
    const capped = createWikiLinkCompletion(() => many);

    expect(capped(contextAt("[["))?.options).toHaveLength(8);
  });

  it("reads suggestions through the getter on every call", () => {
    // The list changes while the editor stays mounted — a folio is created
    // in the tree, a file is uploaded. A captured array would freeze at
    // first render, which is the bug the getter exists to prevent.
    let current: WikiLinkSuggestion[] = [];
    const live = createWikiLinkCompletion(() => current);

    expect(live(contextAt("[["))).toBeNull();

    current = suggestions;

    expect(live(contextAt("[["))?.options).toHaveLength(3);
  });
});
