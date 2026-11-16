import { describe, it } from "vitest";

import { displayName, mentionHandle } from "../src/web/index.ts";

describe("displayName", () => {
  it("shows a person with a name by that name, never the username", ({
    expect,
  }) => {
    const user = {
      firstName: "Ada",
      lastName: "Lovelace",
      username: "ada42",
      email: "ada@example.com",
    };

    expect(displayName(user)).toBe("Ada Lovelace");
    expect(displayName(user)).not.toContain("ada42");
    expect(displayName({ ...user, lastName: null })).toBe("Ada");
    expect(displayName({ ...user, firstName: "  " })).toBe("Lovelace");
  });

  it("falls back to the username, then the email, then the fallback", ({
    expect,
  }) => {
    expect(displayName({ username: "ada42", email: "ada@example.com" })).toBe(
      "ada42",
    );
    expect(displayName({ username: null, email: "ada@example.com" })).toBe(
      "ada@example.com",
    );
    expect(displayName({}, "someone")).toBe("someone");
    expect(displayName(undefined)).toBe("Anonymous");
  });
});

describe("mentionHandle", () => {
  it("ignores the name, which a handle cannot carry", ({ expect }) => {
    const user = {
      firstName: "Ada",
      lastName: "Lovelace",
      username: "ada42",
      email: "ada@example.com",
    };

    expect(mentionHandle(user)).toBe("ada42");
    expect(mentionHandle({ ...user, username: null })).toBe("ada");
  });
});
