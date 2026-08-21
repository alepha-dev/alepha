import { $atom, Alepha, z } from "alepha";
import { beforeEach, describe, expect, it } from "vitest";

import { AtomCookiePersistence } from "../providers/AtomCookiePersistence.browser.ts";

const schema = z.object({ theme: z.string() });

/**
 * Clears every cookie the previous test may have left behind. jsdom's
 * `document.cookie` jar persists across tests within the same suite run.
 */
const clearAllCookies = (): void => {
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name) {
      document.cookie = `${name}=; Path=/; Max-Age=0`;
    }
  }
};

/**
 * Read a single cookie's raw (still encoded) value directly off
 * `document.cookie`, bypassing the adapter under test.
 */
const readRawCookie = (name: string): string | undefined => {
  const match = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : undefined;
};

describe("AtomCookiePersistence (browser)", () => {
  beforeEach(() => {
    clearAllCookies();
  });

  it("hydrates from an existing document.cookie on register", () => {
    document.cookie = `test.cookie.browser.read=${encodeURIComponent(
      JSON.stringify({ theme: "dark" }),
    )}; Path=/`;

    const prefs = $atom({
      name: "test.cookie.browser.read",
      schema,
      default: { theme: "light" },
      persist: "cookie",
    });

    const alepha = Alepha.create();
    alepha.inject(AtomCookiePersistence);

    expect(alepha.store.get(prefs)).toEqual({ theme: "dark" });
  });

  it("reads and writes an atom that registered BEFORE the adapter existed", async () => {
    // The `$module({ atoms, imports, services })` shape: `atoms[]` register
    // before `services[]` are injected, so the adapter never sees the
    // atom's one-shot `state:register` event. Discovering atoms from the
    // state manager's registry (instead of from that event) is what makes
    // this work.
    document.cookie = `test.cookie.browser.module=${encodeURIComponent(
      JSON.stringify({ theme: "dark" }),
    )}; Path=/`;

    const prefs = $atom({
      name: "test.cookie.browser.module",
      schema,
      default: { theme: "light" },
      persist: "cookie",
    });

    const alepha = Alepha.create();
    alepha.store.register(prefs);
    alepha.inject(AtomCookiePersistence);
    await alepha.start();

    expect(alepha.store.get(prefs)).toEqual({ theme: "dark" });

    alepha.store.set(prefs, { theme: "solarized" });
    const raw = readRawCookie("test.cookie.browser.module");
    expect(raw).toBeDefined();
    expect(JSON.parse(decodeURIComponent(raw!))).toEqual({
      theme: "solarized",
    });
  });

  it("falls back to the default when there is no cookie", () => {
    const prefs = $atom({
      name: "test.cookie.browser.none",
      schema,
      default: { theme: "light" },
      persist: "cookie",
    });

    const alepha = Alepha.create();
    alepha.inject(AtomCookiePersistence);

    expect(alepha.store.get(prefs)).toEqual({ theme: "light" });
  });

  it("writes document.cookie back on mutation, using the bare (unprefixed) atom key", () => {
    const prefs = $atom({
      name: "test.cookie.browser.write",
      schema,
      default: { theme: "light" },
      persist: "cookie",
    });

    const alepha = Alepha.create();
    alepha.inject(AtomCookiePersistence);
    alepha.store.set(prefs, { theme: "dark" });

    const raw = readRawCookie("test.cookie.browser.write");
    expect(raw).toBeDefined();
    expect(JSON.parse(decodeURIComponent(raw!))).toEqual({ theme: "dark" });

    // No APP_NAME namespace: the browser cannot see APP_NAME (see this
    // class's JSDoc), and the server side (AtomCookiePersistence.ts)
    // matches by passing `prefix: false` for atom cookies specifically —
    // see AtomCookiePersistence.spec.ts's "cookie-name symmetry with
    // APP_NAME set" suite for the server-side half of this proof.
    expect(readRawCookie("rdm.test.cookie.browser.write")).toBeUndefined();
  });

  it("clears the cookie instead of writing the literal 'undefined' when the atom's value is cleared", () => {
    const prefs = $atom({
      name: "test.cookie.browser.delete",
      schema,
      default: { theme: "light" },
      persist: "cookie",
    });

    const alepha = Alepha.create();
    alepha.inject(AtomCookiePersistence);
    alepha.store.set(prefs, { theme: "dark" });
    expect(readRawCookie("test.cookie.browser.delete")).toBeDefined();

    // Bypass the Atom-typed overload deliberately: `set(key, undefined)` is
    // exactly what `StateManager.del()` does internally, and is the only
    // way to drive the atom back to "no value", which is what triggers the
    // `value === undefined` branch under test.
    alepha.store.set(prefs.key as any, undefined);

    // Must be gone entirely — never the literal string "undefined", which
    // would make the next register()'s `JSON.parse("undefined")` throw.
    expect(readRawCookie("test.cookie.browser.delete")).toBeUndefined();
  });

  it("clears a corrupted cookie instead of leaving it to throw on every future read", () => {
    document.cookie = "test.cookie.browser.corrupt=not-json-at-all; Path=/";

    const prefs = $atom({
      name: "test.cookie.browser.corrupt",
      schema,
      default: { theme: "light" },
      persist: "cookie",
    });

    const alepha = Alepha.create();
    alepha.inject(AtomCookiePersistence);

    // Corrupted value is discarded; the default is used instead of throwing.
    expect(alepha.store.get(prefs)).toEqual({ theme: "light" });

    // And the corrupted cookie itself is cleared, not left behind to keep
    // failing on every future page load.
    expect(readRawCookie("test.cookie.browser.corrupt")).toBeUndefined();
  });
});
