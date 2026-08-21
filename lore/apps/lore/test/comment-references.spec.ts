import { describe, it } from "vitest";

import { expandCommentReferences } from "../src/web/app/components/project/quest/commentReferences.ts";

/**
 * The two reference shapes that belong to comments alone, on their way into
 * the shared element-link resolver. Everything this does NOT touch matters as
 * much as what it does: the same transform, applied to a folio, would turn
 * every "#5" in a document into a link.
 */
const options = {
  projectSlug: "alepha",
  members: [{ name: "nfo" }, { name: "ada" }],
};

describe("expandCommentReferences", () => {
  it("turns a bare quest reference into the wiki form the resolver reads", ({
    expect,
  }) => {
    expect(expandCommentReferences("See #1204 for the rest.", options)).toBe(
      "See [[quest:#1204]] for the rest.",
    );
  });

  it("expands one at the very start of the body", ({ expect }) => {
    expect(expandCommentReferences("#7 blocks this.", options)).toBe(
      "[[quest:#7]] blocks this.",
    );
  });

  it("leaves a reference that is already in wiki form alone", ({ expect }) => {
    const already = "See [[quest:#1204]].";
    expect(expandCommentReferences(already, options)).toBe(already);
  });

  it("leaves a URL fragment alone", ({ expect }) => {
    const link = "[the anchor](/docs/page#42)";
    expect(expandCommentReferences(link, options)).toBe(link);
  });

  it("never reaches inside code", ({ expect }) => {
    const code =
      "Use `#include <stdio.h>` and @ada is not a mention here:\n```\n@ada #12\n```";
    expect(expandCommentReferences(code, options)).toBe(
      "Use `#include <stdio.h>` and [@ada](/alepha/settings/members) is not a mention here:\n```\n@ada #12\n```",
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
