import { describe, it } from "vitest";

import { capitalizeName } from "../src/web/app/services/displayName.ts";
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

  /**
   * Names are capitalized at display time (#Q3886), so every person reads
   * alike whatever case they typed; the stored value is untouched.
   */
  it("capitalizes each word of the first and last name", ({ expect }) => {
    expect(displayName({ firstName: "Thibaut", lastName: "LEFEVRE" })).toBe(
      "Thibaut Lefevre",
    );
    expect(displayName({ firstName: "thibaut", lastName: "lefevre" })).toBe(
      "Thibaut Lefevre",
    );
    expect(displayName({ firstName: "JEAN-PIERRE", lastName: "o'brien" })).toBe(
      "Jean-Pierre O'Brien",
    );
    expect(displayName({ firstName: "ÉLODIE", lastName: "dupré" })).toBe(
      "Élodie Dupré",
    );
    expect(displayName({ firstName: "mary ann", lastName: "VAN DYKE" })).toBe(
      "Mary Ann Van Dyke",
    );
  });

  it("leaves a username and an email as typed: they are handles", ({
    expect,
  }) => {
    expect(displayName({ username: "AdaL" })).toBe("AdaL");
    expect(displayName({ email: "Ada.L@example.com" })).toBe(
      "Ada.L@example.com",
    );
  });
});

describe("capitalizeName", () => {
  it("upper-cases the first letter of each word and lower-cases the rest", ({
    expect,
  }) => {
    expect(capitalizeName("LEFEVRE")).toBe("Lefevre");
    expect(capitalizeName("lefevre")).toBe("Lefevre");
    expect(capitalizeName("saint-ÉTIENNE")).toBe("Saint-Étienne");
    expect(capitalizeName("d\u2019ARTAGNAN")).toBe("D\u2019Artagnan");
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
