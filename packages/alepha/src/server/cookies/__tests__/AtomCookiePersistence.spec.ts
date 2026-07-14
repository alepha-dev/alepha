import { $atom, $inject, $state, Alepha, z } from "alepha";
import { $action, AlephaServer } from "alepha/server";
import { describe, expect, it } from "vitest";
import { AlephaServerCookies } from "../index.ts";

const settingsAtom = $atom({
  name: "test.cookie.settings",
  schema: z.object({ theme: z.string() }),
  default: { theme: "light" },
  persist: "cookie",
});

class CookieAtomApp {
  protected readonly alepha = $inject(Alepha);

  /**
   * Registers the atom at configure time so the adapter tracks it before
   * the first request.
   */
  settings = $state(settingsAtom);

  read = $action({
    schema: {
      response: z.object({ theme: z.string() }),
    },
    handler: () => ({ theme: this.settings.theme }),
  });

  update = $action({
    schema: {
      body: z.object({ theme: z.string() }),
      response: z.object({ ok: z.boolean() }),
    },
    handler: ({ body }) => {
      this.alepha.store.set(settingsAtom, { theme: body.theme });
      return { ok: true };
    },
  });
}

const alepha = Alepha.create().with(AlephaServer).with(AlephaServerCookies);

const app = alepha.inject(CookieAtomApp);

describe("AtomCookiePersistence", () => {
  it("writes a Set-Cookie when a persisted atom mutates during a request", async () => {
    const response = await app.update.fetch({ body: { theme: "dark" } });
    const setCookie = response.raw?.headers.get("set-cookie");

    expect(setCookie).toBeDefined();
    const value = JSON.parse(
      decodeURIComponent(
        setCookie!.match(/test\.cookie\.settings=([^;]*)/)![1],
      ),
    );
    expect(value).toEqual({ theme: "dark" });
  });

  it("seeds request-scoped state from the incoming cookie", async () => {
    const cookieHeader = `test.cookie.settings=${encodeURIComponent(
      JSON.stringify({ theme: "dark" }),
    )}`;

    const response = await app.read.fetch(
      {},
      { request: { headers: { cookie: cookieHeader } } },
    );

    expect(response.data.theme).toBe("dark");
  });

  it("falls back to the default without a cookie", async () => {
    const response = await app.read.fetch(
      {},
      { request: { headers: { cookie: "" } } },
    );

    expect(response.data.theme).toBe("light");
  });
});
