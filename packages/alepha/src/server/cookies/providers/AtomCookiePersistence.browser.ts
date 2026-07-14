import { $hook, $inject, Alepha, type Atom, type State } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import type { Cookie } from "../primitives/$cookie.ts";
import { CookieParser } from "../services/CookieParser.ts";

/**
 * Browser variant of AtomCookiePersistence: reads `document.cookie` for every
 * `persist: "cookie"` atom, and writes it back on every mutation.
 *
 * Like the server variant, atoms are resolved from the `StateManager`
 * registry (`alepha.store.listAtoms()`) rather than from a map fed by
 * `state:register` — that event fires once, is never replayed, and
 * `$module.register()` registers `atoms[]` before the module's `services[]`
 * exist, so an event-sourced map would miss every atom declared the
 * documented way. The `configure` hook sweeps everything registered up to
 * boot; `state:register` covers atoms that first register later (lazily, on
 * first read).
 *
 * Cookie names are NOT APP_NAME-prefixed here, because `APP_NAME` is not
 * reachable in the browser: `BuildClientTask` only `define`s
 * `process.env.NODE_ENV` for the client bundle, and the SSR hydration
 * payload (`ReactServerTemplateProvider.buildHydrationData`) only carries
 * registered atom values + router layers — never the raw `env` store key.
 * The server variant (`AtomCookiePersistence.ts`) matches this by passing
 * `prefix: false` to `ServerCookiesProvider`, specifically for atom-cookie
 * traffic — every other server cookie ($cookie primitive) still gets the
 * APP_NAME namespace. See `ServerCookiesProvider.prefixName`.
 */
export class AtomCookiePersistence {
  protected readonly alepha = $inject(Alepha);
  protected readonly cookieParser = $inject(CookieParser);
  protected readonly dateTime = $inject(DateTimeProvider);

  protected readonly onConfigure = $hook({
    on: "configure",
    handler: () => {
      for (const atom of this.cookieAtoms()) {
        this.read(atom);
      }
    },
  });

  protected readonly onRegister = $hook({
    on: "state:register",
    handler: ({ atom }) => {
      if (atom.options.persist !== "cookie") {
        return;
      }
      this.read(atom);
    },
  });

  protected readonly onMutate = $hook({
    on: "state:mutate",
    handler: ({ key, value }) => {
      const atom = this.alepha.store.getAtom(String(key));
      if (!atom || atom.options.persist !== "cookie") {
        return;
      }

      if (value === undefined) {
        // Without this branch, `store.del(atom)` would write the literal
        // string "undefined", and the next read's `JSON.parse("undefined")`
        // would throw into the catch in `read()` on every page load.
        this.clearCookie(atom.key);
        return;
      }

      const cookie: Cookie = {
        value: encodeURIComponent(JSON.stringify(value)),
        path: "/",
        sameSite: "lax",
        maxAge: this.dateTime.duration([365, "days"]).as("seconds"),
      };
      // biome-ignore lint/suspicious/noDocumentCookie: cookie persistence adapter
      document.cookie = this.cookieParser.cookieToString(atom.key, cookie);
    },
  });

  /**
   * Every registered atom declared with `persist: "cookie"`, read live from
   * the state manager's registry.
   */
  protected cookieAtoms(): Array<Atom<any, any>> {
    return this.alepha.store
      .listAtoms()
      .filter((atom) => atom.options.persist === "cookie");
  }

  /**
   * Seed an atom's state from `document.cookie`, if a cookie exists for it.
   * Idempotent: re-reading an atom that already holds the cookie's value is
   * a no-op write of the same data.
   */
  protected read(atom: Atom<any, any>): void {
    const raw = this.cookieParser.parseRequestCookies(document.cookie)[
      atom.key
    ];
    if (!raw) {
      return;
    }

    try {
      this.alepha.store.set(
        atom.key as keyof State,
        JSON.parse(decodeURIComponent(raw)),
        { skipEvents: true },
      );
    } catch {
      // Corrupted cookie (invalid JSON/encoding, or a value that no longer
      // matches the atom's schema — `store.set` validates against it) —
      // clear it instead of leaving it to keep throwing on every future
      // read. Mirrors the web-storage adapter's parity
      // (StateManager.bindWebStorage removes the bad entry too).
      this.clearCookie(atom.key);
    }
  }

  /**
   * Expire a cookie immediately, mirroring
   * `ServerCookiesProvider.deleteCookie`'s `Max-Age=0` semantics.
   */
  protected clearCookie(name: string): void {
    const cookie: Cookie = {
      value: "",
      path: "/",
      sameSite: "lax",
      maxAge: 0,
    };
    // biome-ignore lint/suspicious/noDocumentCookie: cookie persistence adapter
    document.cookie = this.cookieParser.cookieToString(name, cookie);
  }
}
