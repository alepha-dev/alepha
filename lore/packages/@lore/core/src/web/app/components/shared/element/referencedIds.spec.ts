import { describe, it } from "vitest";

import { referencedIds } from "./referencedIds.ts";

describe("referencedIds", () => {
  it("returns one kind's numbers, ascending and once each", ({ expect }) => {
    const body = "See [[#Q9]], [[#F4]], [[#q2]] and [[#Q9]] again.";

    expect(referencedIds(body, "quest")).toEqual([2, 9]);
    expect(referencedIds(body, "folio")).toEqual([4]);
  });

  it("ignores what is not the typed grammar", ({ expect }) => {
    const body = "[[Title]] [[#Q12#anchor]] [[quest:3]] #Q5 [[ #E1 ]]";

    expect(referencedIds(body, "quest")).toEqual([]);
    expect(referencedIds(body, "epic")).toEqual([1]);
  });

  it("answers nothing for a body with no brackets", ({ expect }) => {
    expect(referencedIds("no references here", "quest")).toEqual([]);
  });
});
