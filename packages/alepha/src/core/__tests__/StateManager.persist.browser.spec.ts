import { beforeEach, describe, expect, it } from "vitest";
import { Alepha } from "../Alepha.ts";
import { $atom } from "../primitives/$atom.ts";
import { z } from "../providers/TypeProvider.ts";

const schema = z.object({ theme: z.string() });

describe("StateManager web storage persistence", () => {
  beforeEach(() => {
    // Always go through `window.*`, matching what the implementation reads
    // (StateManager.getWebStorage uses `window.localStorage` /
    // `window.sessionStorage`, not the bare global). On Node >= 22 with Web
    // Storage enabled (on by default in Node 25), the bare `localStorage` /
    // `sessionStorage` globals are a DIFFERENT object from jsdom's
    // `window.localStorage` / `window.sessionStorage` — mixing the two
    // makes this suite fail for reasons unrelated to the code under test.
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("writes to localStorage when a persisted atom mutates", async () => {
    const prefs = $atom({
      name: "test.persist.write",
      schema,
      default: { theme: "light" },
      persist: "localStorage",
    });

    const alepha = Alepha.create();
    alepha.store.set(prefs, { theme: "dark" });
    await new Promise((r) => setTimeout(r, 0)); // state:mutate is async

    expect(window.localStorage.getItem("test.persist.write")).toBe(
      JSON.stringify({ theme: "dark" }),
    );
  });

  it("hydrates from localStorage on registration in a fresh container", () => {
    window.localStorage.setItem(
      "test.persist.read",
      JSON.stringify({ theme: "dark" }),
    );
    const prefs = $atom({
      name: "test.persist.read",
      schema,
      default: { theme: "light" },
      persist: "localStorage",
    });

    const alepha = Alepha.create();
    expect(alepha.store.get(prefs)).toEqual({ theme: "dark" });
  });

  it("drops an invalid persisted value and keeps the default", () => {
    window.localStorage.setItem(
      "test.persist.bad",
      JSON.stringify({ theme: 42 }),
    );
    const prefs = $atom({
      name: "test.persist.bad",
      schema,
      default: { theme: "light" },
      persist: "localStorage",
    });

    const alepha = Alepha.create();
    expect(alepha.store.get(prefs)).toEqual({ theme: "light" });
    expect(window.localStorage.getItem("test.persist.bad")).toBeNull();
  });

  it("supports sessionStorage", async () => {
    const prefs = $atom({
      name: "test.persist.session",
      schema,
      default: { theme: "light" },
      persist: "sessionStorage",
    });

    const alepha = Alepha.create();
    alepha.store.set(prefs, { theme: "dark" });
    await new Promise((r) => setTimeout(r, 0));

    expect(window.sessionStorage.getItem("test.persist.session")).toBe(
      JSON.stringify({ theme: "dark" }),
    );
  });
});
