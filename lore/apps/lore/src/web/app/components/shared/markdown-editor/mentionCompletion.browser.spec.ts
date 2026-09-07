import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { matchMentions } from "@/web/app/services/mentions.ts";

import { createMentionCompletion } from "./mentionCompletion.ts";

const HANDLES = ["nfo", "feunard", "ada.lovelace", "bob-42"];

/**
 * A real `CompletionContext` over a real `EditorState`, cursor at the end.
 * Same shape as `wikiLinkCompletion.browser.spec.ts` next door: nothing here
 * is a stub, the source is called the way CodeMirror calls it.
 */
const contextAt = (doc: string) =>
  new CompletionContext(
    EditorState.create({ doc, selection: { anchor: doc.length } }),
    doc.length,
    false,
  );

const complete = (doc: string) =>
  createMentionCompletion(() => HANDLES)(contextAt(doc));

describe("the @ completion source", () => {
  it("opens on a handle and offers the matching members", () => {
    const result = complete("ping @fe");

    expect(result?.options.map((it) => it.label)).toEqual(["feunard"]);
  });

  it("matches anywhere in the handle, not only at its start", () => {
    // Same rule as the `[[` picker, and it earns its keep here: a roster is
    // full of `ada.lovelace`, and somebody looking for Ada by surname should
    // find her.
    expect(complete("ping @love")?.options.map((it) => it.label)).toEqual([
      "ada.lovelace",
    ]);
    // Which is why a one-letter query is wide: `f` is inside `nfo` too.
    expect(complete("ping @f")?.options.map((it) => it.label)).toEqual([
      "nfo",
      "feunard",
    ]);
  });

  it("replaces the typed handle and leaves the @ in place", () => {
    const doc = "ping @fe";
    const result = complete(doc);

    // `from` sits just after the `@`, so accepting writes `@feunard` rather
    // than `@@feunard` or `ping feunard`.
    expect(doc.slice(result!.from)).toBe("fe");
    expect(doc[result!.from - 1]).toBe("@");
  });

  it("offers nothing on a bare @", () => {
    // Falls out of reusing `mentionPattern()`, which requires a character
    // after the sigil - the same rule feedback #2112 imposed on `[[`, and a
    // popup that appears the instant you type a symbol is a popup between
    // the author and their text.
    expect(complete("ping @")).toBeNull();
  });

  it("does not open inside an email address", () => {
    // ⚠️ The pattern's whole first group. Without it, typing an address in a
    // comment would open a member picker mid-word.
    expect(complete("write to me@ex")).toBeNull();
  });

  it("opens at the very start of a line, where the lead group is empty", () => {
    const result = complete("@nf");

    expect(result?.options.map((it) => it.label)).toEqual(["nfo"]);
    expect(result?.from).toBe(1);
  });

  it("offers nothing when the query names nobody", () => {
    // ⚠️ Rather than an empty picker: an unmatched handle is a typo or an
    // address, and `resolveMention` leaves it as plain text that pings
    // nobody. The picker must not suggest otherwise by appearing.
    expect(complete("ping @zzz")).toBeNull();
    expect(
      matchMentions(
        "ping @zzz",
        HANDLES.map((name) => ({ name })),
      ),
    ).toEqual([]);
  });

  it("offers only what the renderer would actually link", () => {
    // ⚠️ The reason the source derives its match from `mentionPattern()`
    // instead of writing a second regex: every completion it offers has to
    // be one `matchMentions` resolves, or the picker teaches a handle that
    // links nowhere and reaches nobody's inbox.
    const members = HANDLES.map((name) => ({ name }));

    for (const handle of HANDLES) {
      const offered = complete(`hello @${handle.slice(0, 2)}`);
      expect(offered?.options.map((it) => it.label)).toContain(handle);
      expect(matchMentions(`hello @${handle}`, members)).toEqual([
        { name: handle },
      ]);
    }
  });

  it("mounts nothing when the caller supplies no handles", () => {
    // The scoping the feature depends on: a description or a folio body
    // passes no roster, so `@` there opens nothing at all.
    expect(createMentionCompletion(() => [])(contextAt("ping @f"))).toBeNull();
  });
});
