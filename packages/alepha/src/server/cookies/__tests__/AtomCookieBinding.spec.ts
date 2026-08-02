import { $atom, $inject, Alepha, z } from "alepha";
import { $action, AlephaServer } from "alepha/server";
import { describe, expect, it } from "vitest";
import { $cookie, AlephaServerCookies } from "../index.ts";

/**
 * Regression coverage for the cross-request contamination found in
 * `StateManager.register()`.
 *
 * `$cookie({ key: atom.key })` writes the raw cookie into the request's ALS
 * layer during `server:onRequest`, BEFORE anything ever reads the atom. So on
 * a request that carries the cookie, the atom's very first registration
 * happens inside a fork that already holds its key — and the app-level store
 * never received the declared default. Every later, cookie-LESS request then
 * resolved `undefined` (no fork value, no app value) instead of the default:
 * one user's cookied request permanently defined what every cookie-less user
 * saw.
 *
 * The atom is deliberately NOT declared with `$store(...)` here: it must
 * register lazily, from inside the request, which is exactly what the
 * framework's own `uiAtom` does during SSR.
 */
const themeAtom = $atom({
  name: "test.cookie.binding.theme",
  schema: z.object({ theme: z.string() }),
  default: { theme: "light" },
});

class CookieBoundApp {
  protected readonly alepha = $inject(Alepha);

  theme = $cookie({
    key: themeAtom.key,
    name: "test-cookie-binding-theme",
    schema: z.object({ theme: z.string() }),
  });

  read = $action({
    schema: {
      response: z.object({ theme: z.string() }),
    },
    // Lazy: the atom is first registered here, inside the request.
    handler: () => ({ theme: this.alepha.store.get(themeAtom).theme }),
  });
}

const alepha = Alepha.create().with(AlephaServer).with(AlephaServerCookies);
const app = alepha.inject(CookieBoundApp);

const cookieHeader = `test-cookie-binding-theme=${encodeURIComponent(
  JSON.stringify({ theme: "dark" }),
)}`;

describe("atom bound to a $cookie, first registered inside a request", () => {
  it("serves the default to a cookie-less request that follows a cookied one", async () => {
    // Request 1 — WITH the cookie. This is the request that registers the
    // atom, from inside a fork that already carries its key.
    const first = await app.read.fetch(
      {},
      {
        key: "binding-with-cookie",
        request: { headers: { cookie: cookieHeader } },
      },
    );
    expect(first.data.theme).toBe("dark");

    // Request 2 — WITHOUT any cookie. Before the fix this resolved
    // `undefined` (the app store never got the default), which then blew up
    // as a TypeError on any direct `.theme` read.
    const second = await app.read.fetch(
      {},
      { key: "binding-no-cookie", request: { headers: { cookie: "" } } },
    );
    expect(second.data.theme).toBe("light");

    // The app-level store holds the declared DEFAULT — not `undefined`, and
    // not the first request's cookie value.
    expect(alepha.store.get(themeAtom, "app")).toEqual({ theme: "light" });
  });
});
