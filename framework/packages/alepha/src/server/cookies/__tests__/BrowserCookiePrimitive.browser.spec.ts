import { $atom, Alepha, z } from "alepha";
import { beforeEach, describe, it } from "vitest";

import { $cookie } from "../primitives/$cookie.browser.ts";

/**
 * Hands `document.cookie` writes to the spec: jsdom's own jar keeps a
 * cookie's value and drops its attributes, so `Max-Age` cannot be read back.
 */
const recordCookieWrites = (): string[] => {
  const writes: string[] = [];
  const native = Object.getOwnPropertyDescriptor(Document.prototype, "cookie")!;
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => native.get!.call(document),
    set: (value: string) => {
      writes.push(value);
      native.set!.call(document, value);
    },
  });
  return writes;
};

class Prefs {
  prefs = $cookie({
    name: "user-prefs",
    schema: z.object({ theme: z.text() }),
    ttl: [30, "days"],
  });
}

describe("BrowserCookiePrimitive", () => {
  beforeEach(() => {
    delete (document as { cookie?: string }).cookie;
    document.cookie = "user-prefs=; Path=/; Max-Age=0";
  });

  it("reads back what it set", ({ expect }) => {
    const { prefs } = Alepha.create().inject(Prefs);

    prefs.set({ theme: "dark" });

    expect(prefs.get()).toEqual({ theme: "dark" });
  });

  it("returns undefined for a value that does not decode, and clears it", ({
    expect,
  }) => {
    const { prefs } = Alepha.create().inject(Prefs);
    document.cookie = "user-prefs=%; Path=/";

    expect(prefs.get()).toBeUndefined();
    expect(document.cookie).not.toContain("user-prefs");
  });

  it("returns undefined for a value that is not JSON, and clears it", ({
    expect,
  }) => {
    const { prefs } = Alepha.create().inject(Prefs);
    document.cookie = "user-prefs=not-json; Path=/";

    expect(prefs.get()).toBeUndefined();
    expect(document.cookie).not.toContain("user-prefs");
  });

  it("returns undefined for a value the schema refuses, and clears it", ({
    expect,
  }) => {
    const { prefs } = Alepha.create().inject(Prefs);
    document.cookie = `user-prefs=${encodeURIComponent(JSON.stringify({ theme: 4 }))}; Path=/`;

    expect(prefs.get()).toBeUndefined();
    expect(document.cookie).not.toContain("user-prefs");
  });

  it("writes the declared ttl as Max-Age", ({ expect }) => {
    const { prefs } = Alepha.create().inject(Prefs);
    const writes = recordCookieWrites();

    prefs.set({ theme: "dark" });

    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain(`Max-Age=${30 * 24 * 3600};`);
  });

  it("writes a ttl given to set() in place of the declared one", ({
    expect,
  }) => {
    const { prefs } = Alepha.create().inject(Prefs);
    const writes = recordCookieWrites();

    prefs.set({ theme: "dark" }, { ttl: [1, "hour"] });

    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("Max-Age=3600;");
  });

  it("clears the cookie when the atom it is bound to is cleared", ({
    expect,
  }) => {
    const bound = $atom({
      name: "test.cookie.browser.bound",
      schema: z.object({ theme: z.text() }),
      default: { theme: "light" },
    });
    class Bound {
      prefs = $cookie({
        key: bound.key,
        name: "user-prefs",
        schema: z.object({ theme: z.text() }),
      });
    }
    const alepha = Alepha.create();
    alepha.inject(Bound);
    alepha.store.set(bound, { theme: "dark" });
    expect(document.cookie).toContain("user-prefs=");

    alepha.store.set(bound.key, undefined);

    expect(document.cookie).not.toContain("user-prefs");
  });
});
