import { describe, it } from "vitest";

import { matchesProjectErrorStatus } from "./projectErrorStatusFilter.ts";

const open = { status: "open" };
const resolved = { status: "resolved" };
const seenAgain = { status: "resolved", seenAgain: true };
const forwarded = { status: "quest:12" };
const all = [open, resolved, seenAgain, forwarded];

/**
 * The inbox's Status filter (#Q4466): each choice alone, two together, and
 * none.
 */
describe("matchesProjectErrorStatus", () => {
  const kept = (choices: Array<"open" | "resolved" | "seenAgain">) =>
    all.filter((error) => matchesProjectErrorStatus(error, choices));

  it("keeps every error when nothing is picked, the forwarded ones included", ({
    expect,
  }) => {
    expect(kept([])).toEqual(all);
  });

  it("narrows to one choice", ({ expect }) => {
    expect(kept(["open"])).toEqual([open]);
    expect(kept(["resolved"])).toEqual([resolved, seenAgain]);
    expect(kept(["seenAgain"])).toEqual([seenAgain]);
  });

  it("keeps what any of two choices asks for, and nothing else", ({
    expect,
  }) => {
    // Seen again is a kind of resolved: together they are the resolved ones,
    // never the open or the forwarded.
    expect(kept(["resolved", "seenAgain"])).toEqual([resolved, seenAgain]);
    expect(kept(["open", "seenAgain"])).toEqual([open, seenAgain]);
    expect(kept(["open", "resolved"])).toEqual([open, resolved, seenAgain]);
  });
});
