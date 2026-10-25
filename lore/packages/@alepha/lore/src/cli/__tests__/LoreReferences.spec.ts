import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { LoreReferences } from "../services/LoreReferences.ts";

describe("LoreReferences", () => {
  const refs = () => Alepha.create().inject(LoreReferences);

  it("reads a quest as 12, Q12, q12 or #Q12", ({ expect }) => {
    const parse = refs();

    expect(
      ["12", "Q12", "q12", "#Q12", "#12", " Q12 "].map((ref) =>
        parse.quest(ref),
      ),
    ).toEqual([12, 12, 12, 12, 12, 12]);
  });

  it("reads a folio as F12 and an epic as E45", ({ expect }) => {
    const parse = refs();

    expect(parse.folio("F1264")).toBe(1264);
    expect(parse.folio("#F3")).toBe(3);
    expect(parse.epic("45")).toBe(45);
    expect(parse.epic("E45")).toBe(45);
  });

  /**
   * A letter from another kind is a mistake worth catching: `lore quest get
   * F12` would otherwise read quest 12, a different entity.
   */
  it("refuses another kind's letter, zero, and anything else", ({ expect }) => {
    const parse = refs();

    for (const bad of ["F12", "E12", "Q0", "0", "Q", "", "12a", "Q-1"]) {
      expect(() => parse.quest(bad)).toThrow("is not a quest reference");
    }
  });

  it("says a # has to be quoted, since that is the likeliest way to get here", ({
    expect,
  }) => {
    expect(() => refs().quest("oops")).toThrow(
      "unquoted, a shell reads # as a comment",
    );
  });
});
