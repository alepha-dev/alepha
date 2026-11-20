import { describe, it } from "vitest";

import { chatMarkdown } from "./chatMarkdown.ts";

/**
 * A mention becomes a link the room can tell apart, and draws as a pill:
 * its URL carries `?mention=`.
 */
describe("chatMarkdown mentions", () => {
  const members = [{ name: "nfo" }, { name: "lore" }];

  it("marks a member's or an agent's handle as a mention", ({ expect }) => {
    const out = chatMarkdown("@lore and @nfo, look", {
      projectSlug: "acme",
      members,
    });

    expect(out).toContain("[@lore](/acme/settings/members?mention=lore)");
    expect(out).toContain("[@nfo](/acme/settings/members?mention=nfo)");
  });

  it("leaves an unknown handle and code alone", ({ expect }) => {
    const out = chatMarkdown("@ghost `@nfo`", { projectSlug: "acme", members });

    expect(out).toBe("@ghost `@nfo`");
  });
});
