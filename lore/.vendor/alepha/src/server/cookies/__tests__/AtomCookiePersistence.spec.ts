import { $atom, $inject, $module, $store, Alepha, z } from "alepha";
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
  settings = $store(settingsAtom);

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

describe("registration order: atoms declared on a $module, before the adapter exists", () => {
  // The documented usage shape — and the one that used to make
  // `persist: "cookie"` a silent no-op in BOTH directions.
  //
  // `$module.register()` registers `options.atoms` FIRST, then wires
  // `imports[]`, then injects `services[]`. So by the time
  // `AtomCookiePersistence` is instantiated (via the `AlephaServerCookies`
  // import), the atom has already registered and its one-shot
  // `state:register` event has already been emitted and dropped —
  // `EventManager` has no replay buffer. An adapter that discovered atoms
  // from that event kept an empty map forever: no cookie read on request, no
  // Set-Cookie on mutation, no warning.
  //
  // A test that injects the adapter before touching the atom proves nothing;
  // it just reproduces the fragile ordering that happened to work.
  const modulePrefs = $atom({
    name: "test.cookie.module.prefs",
    schema: z.object({ theme: z.string() }),
    default: { theme: "light" },
    persist: "cookie",
  });

  class ModuleCookieApp {
    protected readonly alepha = $inject(Alepha);

    read = $action({
      schema: {
        response: z.object({ theme: z.string() }),
      },
      handler: () => ({ theme: this.alepha.store.get(modulePrefs).theme }),
    });

    update = $action({
      schema: {
        body: z.object({ theme: z.string() }),
        response: z.object({ ok: z.boolean() }),
      },
      handler: ({ body }) => {
        this.alepha.store.set(modulePrefs, { theme: body.theme });
        return { ok: true };
      },
    });
  }

  const CookieAtomModule = $module({
    name: "test.cookie.module",
    atoms: [modulePrefs],
    imports: [AlephaServerCookies],
    services: [ModuleCookieApp],
  });

  const moduleAlepha = Alepha.create().with(CookieAtomModule);
  const moduleApp = moduleAlepha.inject(ModuleCookieApp);

  it("seeds request state from the incoming cookie", async () => {
    const cookieHeader = `test.cookie.module.prefs=${encodeURIComponent(
      JSON.stringify({ theme: "dark" }),
    )}`;

    const response = await moduleApp.read.fetch(
      {},
      {
        key: "module-read",
        request: { headers: { cookie: cookieHeader } },
      },
    );

    expect(response.data.theme).toBe("dark");
  });

  it("emits a Set-Cookie when the atom mutates", async () => {
    const response = await moduleApp.update.fetch({ body: { theme: "dark" } });
    const setCookie = response.raw?.headers.get("set-cookie");

    expect(setCookie).toBeDefined();
    expect(setCookie).not.toBeNull();
    const value = JSON.parse(
      decodeURIComponent(
        setCookie!.match(/test\.cookie\.module\.prefs=([^;]*)/)![1],
      ),
    );
    expect(value).toEqual({ theme: "dark" });
  });

  it("falls back to the default without a cookie", async () => {
    const response = await moduleApp.read.fetch(
      {},
      { key: "module-read-none", request: { headers: { cookie: "" } } },
    );

    expect(response.data.theme).toBe("light");
  });
});

describe("cookie-name symmetry with APP_NAME set", () => {
  // ServerCookiesProvider.getCookie/setCookie normally namespace every
  // cookie under `${APP_NAME.toLowerCase()}.${name}`. The browser variant
  // of this adapter (AtomCookiePersistence.browser.ts) can never see
  // APP_NAME — it is not baked into the client bundle and not part of SSR
  // hydration — so it always reads/writes the BARE atom key. Without the
  // `prefix: false` override in AtomCookiePersistence.cookieOptions(), a
  // client-side mutation would write `theme`, the server would look for
  // `rdm.theme`, miss, and SSR the default — flash of wrong state on every
  // reload. These tests must run with APP_NAME set: without it, both sides
  // collapse to the bare key and the asymmetry is invisible.
  const appNameSettingsAtom = $atom({
    name: "test.cookie.appname",
    schema: z.object({ theme: z.string() }),
    default: { theme: "light" },
    persist: "cookie",
  });

  class AppNameCookieAtomApp {
    protected readonly alepha = $inject(Alepha);

    settings = $store(appNameSettingsAtom);

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
        this.alepha.store.set(appNameSettingsAtom, { theme: body.theme });
        return { ok: true };
      },
    });
  }

  const appNameAlepha = Alepha.create({ env: { APP_NAME: "RDM" } })
    .with(AlephaServer)
    .with(AlephaServerCookies);

  const appNameApp = appNameAlepha.inject(AppNameCookieAtomApp);

  it("writes the bare (unprefixed) cookie name — the same name the browser variant writes", async () => {
    const response = await appNameApp.update.fetch({
      body: { theme: "dark" },
    });
    const setCookie = response.raw?.headers.get("set-cookie");

    expect(setCookie).toBeDefined();
    expect(setCookie).toMatch(/^test\.cookie\.appname=/);
    // The bug this guards against: the namespaced name showing up instead.
    expect(setCookie).not.toMatch(/rdm\.test\.cookie\.appname/);
  });

  it("reads back a bare-named incoming cookie — the same name the browser variant reads", async () => {
    const cookieHeader = `test.cookie.appname=${encodeURIComponent(
      JSON.stringify({ theme: "dark" }),
    )}`;

    const response = await appNameApp.read.fetch(
      {},
      { request: { headers: { cookie: cookieHeader } } },
    );

    expect(response.data.theme).toBe("dark");
  });
});

describe("request isolation (cookie-seeded state never leaks across concurrent requests)", () => {
  // Permanent regression coverage for the invariant confirmed during
  // review: cookie-seeded atom state stays fork-local (each request runs
  // inside its own AsyncLocalStorage fork — see ServerRouterProvider /
  // AlsProvider), and the app-level store never sees a request's value.
  // GET requests dedupe by `{url, method}` in HttpClient (ignoring
  // headers), so each concurrent call below needs a distinct `key` to
  // actually hit the server three times instead of sharing one response.
  it("keeps concurrent requests' cookie-seeded values isolated, and never touches the app-level store", async () => {
    const cookieFor = (theme: string) =>
      `test.cookie.settings=${encodeURIComponent(JSON.stringify({ theme }))}`;

    const [alice, bob, none] = await Promise.all([
      app.read.fetch(
        {},
        {
          key: "isolation-alice",
          request: { headers: { cookie: cookieFor("alice") } },
        },
      ),
      app.read.fetch(
        {},
        {
          key: "isolation-bob",
          request: { headers: { cookie: cookieFor("bob") } },
        },
      ),
      app.read.fetch(
        {},
        {
          key: "isolation-none",
          request: { headers: { cookie: "" } },
        },
      ),
    ]);

    expect(alice.data.theme).toBe("alice");
    expect(bob.data.theme).toBe("bob");
    expect(none.data.theme).toBe("light"); // default, not a leaked neighbor value

    // The root (app-level) store must never have been mutated by a
    // request-scoped cookie read.
    expect(alepha.store.get(settingsAtom, "app")).toEqual({ theme: "light" });
  });
});
