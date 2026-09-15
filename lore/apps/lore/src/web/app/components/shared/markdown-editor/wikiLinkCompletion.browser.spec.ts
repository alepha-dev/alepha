import { type Completion, CompletionContext } from "@codemirror/autocomplete";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
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

  describe("when the picker opens", () => {
    /**
     * Feedback #2112. The picker used to open on a bare `[[` and show the
     * first eight suggestions before the author had said what they wanted,
     * which while writing markdown is a popup between you and the text. The
     * three cases below are the rule; they are stated as a group because
     * "opens on `[[#x`" is only meaningful next to "does not open on `[[`".
     */
    it("stays shut on a bare [[", () => {
      expect(source(contextAt("see [["))).toBeNull();
    });

    it("stays shut on [[# with nothing after it", () => {
      expect(source(contextAt("see [[#"))).toBeNull();
    });

    it("opens once # and one character are typed", () => {
      // All three match `f`: two by their `#F…` token, one by "Fix the
      // tree". The point of the case is that it opens at all, one keystroke
      // after the state above where it must not.
      expect(source(contextAt("see [[#f"))?.options).toHaveLength(3);
    });
  });

  describe("the query the filter sees", () => {
    /**
     * The `#` is dropped before filtering, and that is the decision this
     * quest actually turned on: no folio is called "#account", so a query
     * that kept the hash would match `token` only and the label branch would
     * become dead code. Title lookup dying silently is worse than the bug
     * being fixed.
     */
    it("matches a title, with the hash typed", () => {
      const result = source(contextAt("see [[#depl"));

      expect(result?.options.map((o) => o.label)).toEqual(["Deploy runbook"]);
    });

    it("matches a token, case-insensitively", () => {
      const result = source(contextAt("see [[#q19"));

      expect(result?.options.map((o) => o.label)).toEqual(["Fix the tree"]);
    });

    it("offers nothing when the query matches nothing", () => {
      expect(source(contextAt("see [[#zzzz"))).toBeNull();
    });
  });

  describe("what accepting a suggestion writes", () => {
    /**
     * Accepts the first suggestion over `doc` with the cursor at `cursor`,
     * through the option's own `apply`, and returns the document and cursor
     * it leaves. `apply` reads `state` and calls `dispatch` and nothing else,
     * so it runs against an object carrying those two over a real state: a
     * live `EditorView` needs a layout jsdom does not have.
     */
    const accept = (doc: string, cursor = doc.length) => {
      let state = EditorState.create({ doc, selection: { anchor: cursor } });
      const result = source(new CompletionContext(state, cursor, false))!;
      const option = result.options[0];
      const view = {
        get state() {
          return state;
        },
        dispatch: (spec: TransactionSpec) => {
          state = state.update(spec).state;
        },
      };
      const apply = option.apply as (
        view: EditorView,
        completion: Completion,
        from: number,
        to: number,
      ) => void;
      apply(view as unknown as EditorView, option, result.from, cursor);
      return { doc: state.doc.toString(), cursor: state.selection.main.head };
    };

    it("closes the token when no brackets follow the cursor", () => {
      expect(accept("see [[#depl")).toEqual({
        doc: "see [[#F7]]",
        cursor: 11,
      });
    });

    it("leaves exactly one ]] when closeBrackets already typed them", () => {
      // #Q2355: typing `[[` auto-closes to `[[]]`, the query lands between
      // the pairs, and the apply used to add its own `]]` beside the ones
      // already there.
      expect(accept("see [[#depl]] and more", 11)).toEqual({
        doc: "see [[#F7]] and more",
        cursor: 11,
      });
    });

    it("completes a lone closing bracket to a pair", () => {
      expect(accept("see [[#depl] and", 11)).toEqual({
        doc: "see [[#F7]] and",
        cursor: 11,
      });
    });

    it("anchors the replacement after the brackets, not after the hash", () => {
      // `see [[` is 6 characters, so the query starts at 6: the brackets are
      // never replaced and the author's `#` IS. That is deliberate — the
      // token carries its own hash, so anchoring at 7 to "skip" the one
      // already typed would write `[[##F7]]`, which the end-to-end case
      // above would show.
      expect(source(contextAt("see [[#depl"))?.from).toBe(6);
    });
  });

  it("keeps CodeMirror's own filter out of it", () => {
    // Load-bearing, and it took a browser to find. `from` sits at the
    // brackets, so the text CodeMirror would fuzzy-match is `#depl`, and it
    // matches that against the option LABEL only - no folio is called
    // "#depl", so every option this source selected was then discarded and
    // the picker rendered nothing. It is also why token lookup (`[[#q19`)
    // only ever worked in this file and never in the editor.
    expect(source(contextAt("see [[#depl"))?.filter).toBe(false);
  });

  describe("validFor, which governs the picker once it is open", () => {
    /**
     * CodeMirror re-checks this pattern against the text from `from` as the
     * author keeps typing, and only re-runs the source when it stops
     * matching. It therefore has to encode the same rule as the match
     * pattern: with the old `/^[^\]\n]*$/` the picker opened correctly on
     * `[[#f` and then STAYED open through backspacing to `[[`, which is the
     * one state this whole change exists to exclude.
     */
    const validFor = source(contextAt("see [[#f"))!.validFor as RegExp;

    it("accepts a hash and a query", () => {
      expect(validFor.test("#f")).toBe(true);
      expect(validFor.test("#F7")).toBe(true);
    });

    it("rejects backspacing back to the bare brackets", () => {
      // The text from `from` after deleting `f` then `#`.
      expect(validFor.test("#")).toBe(false);
      expect(validFor.test("")).toBe(false);
    });

    it("rejects a closing bracket and a newline, like the match pattern", () => {
      expect(validFor.test("#F7]")).toBe(false);
      expect(validFor.test("#F7\n")).toBe(false);
    });
  });

  it("does not reopen over an already-closed reference", () => {
    // The caret sits after `]]`. Without the `[^\]\n]` bound in the match
    // pattern this would still look like an open token and the picker would
    // pop up over finished text.
    expect(source(contextAt("see [[#F7]]"))).toBeNull();
  });

  it("does not cross a newline", () => {
    expect(source(contextAt("see [[#\nnext line"))).toBeNull();
  });

  it("caps the list at eight entries", () => {
    const many: WikiLinkSuggestion[] = Array.from({ length: 30 }, (_, i) => ({
      key: `folio:${i}`,
      kind: "folio" as const,
      token: `#F${i}`,
      label: `Folio ${i}`,
    }));
    const capped = createWikiLinkCompletion(() => many);

    expect(capped(contextAt("[[#folio"))?.options).toHaveLength(8);
  });

  it("reads suggestions through the getter on every call", () => {
    // The list changes while the editor stays mounted — a folio is created
    // in the tree, a file is uploaded. A captured array would freeze at
    // first render, which is the bug the getter exists to prevent.
    let current: WikiLinkSuggestion[] = [];
    const live = createWikiLinkCompletion(() => current);

    expect(live(contextAt("[[#f"))).toBeNull();

    current = suggestions;

    expect(live(contextAt("[[#f"))?.options).toHaveLength(3);
  });
});
