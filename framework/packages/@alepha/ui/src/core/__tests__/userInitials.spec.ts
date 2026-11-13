import { describe, it } from "vitest";

import {
  USER_AVATAR_TONES,
  userAvatarTone,
  userInitials,
} from "../userInitials.ts";

/**
 * The initials an avatar draws with no picture, and its colour.
 */
describe("userInitials", () => {
  const id = "0192e4c4-0000-7000-8000-000000000001";

  it("takes the first and last names' first letters", ({ expect }) => {
    expect(userInitials({ id, firstName: "ada", lastName: "lovelace" })).toBe(
      "AL",
    );
  });

  it("takes one name's first two letters when there is only one", ({
    expect,
  }) => {
    expect(userInitials({ id, firstName: "Grace" })).toBe("GR");
    expect(userInitials({ id, lastName: "Hopper" })).toBe("HO");
  });

  it("falls back to the username, then the email before its @", ({
    expect,
  }) => {
    expect(userInitials({ id, username: "ada", email: "x@y.z" })).toBe("AD");
    expect(userInitials({ id, email: "grace.h@example.app" })).toBe("GR");
  });

  it("answers nothing when there is nothing to draw from", ({ expect }) => {
    expect(userInitials({ id })).toBe("");
    expect(userInitials({ id, username: "..." })).toBe("");
  });

  it("skips leading characters that are not letters or digits", ({
    expect,
  }) => {
    expect(userInitials({ id, username: ".john" })).toBe("JO");
    expect(userInitials({ id, email: "_x9@example.app" })).toBe("X9");
  });

  it("splits by grapheme, so no letter or emoji is cut in half", ({
    expect,
  }) => {
    // A decomposed accent: the letter and its combining mark are one.
    expect(userInitials({ id, firstName: "Émile", lastName: "Zola" })).toBe(
      "ÉZ",
    );
    expect(
      userInitials({ id, firstName: "Élodie", lastName: "Ödegaard" }),
    ).toBe("ÉÖ");
    expect(userInitials({ id, firstName: "王", lastName: "小明" })).toBe(
      "王小",
    );
    // An emoji is no letter, so it is skipped like punctuation.
    expect(userInitials({ id, username: "🙂bob" })).toBe("BO");
  });

  it("uppercases in the viewer's locale", ({ expect }) => {
    expect(userInitials({ id, firstName: "ilker" }, "tr")).toBe("İL");
    expect(userInitials({ id, firstName: "ilker" }, "en")).toBe("IL");
  });
});

describe("userAvatarTone", () => {
  it("is always the same for one id, and one of the fixed tones", ({
    expect,
  }) => {
    const id = "0192e4c4-0000-7000-8000-000000000001";
    expect(userAvatarTone(id)).toBe(userAvatarTone(id));
    expect(USER_AVATAR_TONES).toContain(userAvatarTone(id));
  });

  it("spreads ids over the palette", ({ expect }) => {
    const tones = new Set(
      Array.from({ length: 64 }, (_, i) =>
        userAvatarTone(
          `0192e4c4-0000-7000-8000-${String(i).padStart(12, "0")}`,
        ),
      ),
    );
    expect(tones.size).toBeGreaterThan(4);
  });
});
