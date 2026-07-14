import { $hook, $inject, Alepha, type Atom, type State } from "alepha";
import type { DurationLike } from "alepha/datetime";
import { $logger } from "alepha/logger";
import type { Cookies } from "../primitives/$cookie.ts";
import { ServerCookiesProvider } from "./ServerCookiesProvider.ts";

/**
 * Binds every atom declared with `persist: "cookie"` to an HTTP cookie.
 *
 * - `state:register` — starts tracking the atom; if we are already inside a
 *   request (atom registered lazily during SSR render), reads the cookie
 *   immediately so the render sees the persisted value.
 * - `server:onRequest` — seeds the request-scoped state from the cookie, so
 *   SSR renders with the persisted value.
 * - `state:mutate` — writes the new value back as a Set-Cookie header.
 *
 * The cookie is named after the atom key, lives 365 days, SameSite=lax,
 * path "/". For custom cookie options (encryption, signing, custom TTL),
 * declare an explicit `$cookie({ key: atom.key, ... })` binding instead.
 */
export class AtomCookiePersistence {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly serverCookies = $inject(ServerCookiesProvider);
  protected readonly atoms = new Map<string, Atom<any, any>>();

  protected readonly onRegister = $hook({
    on: "state:register",
    handler: ({ atom }) => {
      if (atom.options.persist !== "cookie") {
        return;
      }
      this.atoms.set(atom.key, atom);

      if (this.alepha.store.get("alepha.http.request")) {
        this.read(atom);
      }
    },
  });

  protected readonly onRequest = $hook({
    on: "server:onRequest",
    handler: ({ request }) => {
      // `alepha.http.request` is not set in the store yet at this point in
      // the request lifecycle (`ServerRouterProvider` sets it only after
      // `server:onRequest` resolves), so the request-scoped cookie jar must
      // be passed explicitly rather than resolved from context.
      for (const atom of this.atoms.values()) {
        this.read(atom, request.cookies);
      }
    },
  });

  protected readonly onMutate = $hook({
    on: "state:mutate",
    handler: ({ key, value }) => {
      const atom = this.atoms.get(key as string);
      if (!atom) {
        return;
      }
      try {
        this.serverCookies.setCookie(atom.key, this.cookieOptions(atom), value);
      } catch (error) {
        // Outside a request cycle there is no response to attach the
        // Set-Cookie header to; browser-side writes are handled by the
        // browser variant of this provider.
        this.log.debug(`Cannot persist atom "${atom.key}" to cookie`, {
          error,
        });
      }
    },
  });

  protected read(atom: Atom<any, any>, cookies?: Cookies): void {
    try {
      const value = this.serverCookies.getCookie(
        atom.key,
        this.cookieOptions(atom),
        cookies,
      );
      if (value !== undefined) {
        this.alepha.store.set(atom.key as keyof State, value, {
          skipEvents: true,
        });
      }
    } catch (error) {
      this.log.debug(`Cannot read cookie for atom "${atom.key}"`, { error });
    }
  }

  protected cookieOptions(atom: Atom<any, any>) {
    return {
      schema: atom.schema,
      path: "/",
      sameSite: "lax" as const,
      ttl: [365, "days"] as DurationLike,
    };
  }
}
