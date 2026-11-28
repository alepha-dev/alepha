import { describe, it } from "vitest";

import { questPromptItem } from "./questPromptItem.ts";

/**
 * The status a quest's pinned prompts are offered against, derived with the
 * precedence of `QuestResourceMapper.questStatus`.
 */
describe("questPromptItem", () => {
  const at = "2026-11-28T10:00:00.000Z";

  it("reads a draft as draft, so a prompt refusing drafts is not offered", ({
    expect,
  }) => {
    expect(questPromptItem({ shortId: 7, draftAt: at })).toEqual({
      type: "quest",
      value: "7",
      status: "draft",
    });
  });

  it("reads a quest with no stamp as todo", ({ expect }) => {
    expect(questPromptItem({ shortId: 7 }).status).toBe("todo");
  });

  it("puts a draft below shelved and on hold, as the server does", ({
    expect,
  }) => {
    expect(
      questPromptItem({ shortId: 7, draftAt: at, shelvedAt: at }).status,
    ).toBe("shelved");
    expect(
      questPromptItem({ shortId: 7, draftAt: at, heldAt: at }).status,
    ).toBe("on_hold");
    expect(
      questPromptItem({ shortId: 7, draftAt: at, acceptedAt: at }).status,
    ).toBe("in_progress");
  });
});
