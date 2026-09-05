import { describe, it } from "vitest";

import { expandCommentReferences } from "../src/web/app/components/project/quest/commentReferences.ts";

/**
 * The two reference shapes that belong to comments alone, on their way into
 * the shared element-link resolver. Everything this does NOT touch matters as
 * much as what it does: the same transform, applied to a folio, would turn
 * every reference quoted in a document into a link.
 */
const options = {
  projectSlug: "alepha",
  members: [{ name: "nfo" }, { name: "ada" }],
};

describe("expandCommentReferences", () => {
  it("turns a bare typed reference into the wiki form the resolver reads", ({
    expect,
  }) => {
    expect(expandCommentReferences("See #Q1204 for the rest.", options)).toBe(
      "See [[#Q1204]] for the rest.",
    );
  });

  it("expands one at the very start of the body", ({ expect }) => {
    expect(expandCommentReferences("#Q7 blocks this.", options)).toBe(
      "[[#Q7]] blocks this.",
    );
  });

  it("expands every letter, and writes the letter uppercase", ({ expect }) => {
    expect(
      expandCommentReferences("#e3, #F12, #p120 and #r7 too.", options),
    ).toBe("[[#E3]], [[#F12]], [[#P120]] and [[#R7]] too.");
  });

  it("leaves an untyped #N as plain text (epic #32)", ({ expect }) => {
    // It names no kind, and guessing "quest" is the ambiguity the typed
    // grammar exists to remove.
    const untyped = "See #1204 for the rest.";
    expect(expandCommentReferences(untyped, options)).toBe(untyped);
  });

  it("leaves a letter no kind claims alone", ({ expect }) => {
    const unknown = "Try #X12 or #ZZ9.";
    expect(expandCommentReferences(unknown, options)).toBe(unknown);
  });

  it("leaves a reference that is already in wiki form alone", ({ expect }) => {
    const already = "See [[#Q1204]].";
    expect(expandCommentReferences(already, options)).toBe(already);
  });

  it("leaves a URL fragment alone", ({ expect }) => {
    const link = "[the anchor](/docs/page#Q42)";
    expect(expandCommentReferences(link, options)).toBe(link);
  });

  it("never reaches inside code", ({ expect }) => {
    const code =
      "Use `#include <stdio.h>` and @ada is not a mention here:\n```\n@ada #Q12\n```";
    expect(expandCommentReferences(code, options)).toBe(
      "Use `#include <stdio.h>` and [@ada](/alepha/settings/members) is not a mention here:\n```\n@ada #Q12\n```",
    );
  });

  it("links a mention that matches a member", ({ expect }) => {
    expect(expandCommentReferences("ping @nfo about this", options)).toBe(
      "ping [@nfo](/alepha/settings/members) about this",
    );
  });

  it("leaves an unmatched mention as plain text", ({ expect }) => {
    // A typo or an email address; neither should render as a live link.
    const body = "mail me at hi@example.com or ping @nobody";
    expect(expandCommentReferences(body, options)).toBe(body);
  });

  it("matches a mention case-insensitively", ({ expect }) => {
    expect(expandCommentReferences("@Ada please look", options)).toBe(
      "[@Ada](/alepha/settings/members) please look",
    );
  });
});
