import { $hook, $inject, Alepha, type Atom, type State } from "alepha";
import type { DurationLike } from "alepha/datetime";
import { $logger } from "alepha/logger";
import type { Cookies } from "../primitives/$cookie.ts";
import { ServerCookiesProvider } from "./ServerCookiesProvider.ts";

/**
 * Binds every atom declared with `persist: "cookie"` to an HTTP cookie.
 *
 * - `server:onRequest`: seeds the request-scoped state from the cookie, so
 *   SSR renders with the persisted value.
 * - `state:mutate`: writes the new value back as a Set-Cookie header.
 * - `state:register`: an atom registering lazily *during* a request (first
 *   touched by an SSR render, after `server:onRequest` already ran) reads
 *   its cookie right away, so that render still sees the persisted value.
 *
 * Atoms are resolved from the `StateManager` registry
 * (`alepha.store.listAtoms()`) on every request and every mutation, never
 * from a map built up from `state:register` events. That event fires exactly
 * once per atom and is never replayed, while `$module.register()` registers
 * `atoms[]` BEFORE it wires `imports[]` and injects `services[]` - so the
 * documented `$module({ atoms, imports: [AlephaServerCookies], services })`
 * shape registers every atom before this provider exists. An event-sourced
 * map would stay empty forever there, making `persist: "cookie"` a silent
 * no-op in both directions. Reading the registry on demand is
 * order-independent.
 *
 * The cookie is named after the atom key, lives 365 days, SameSite=lax,
 * path "/". For custom cookie options (encryption, signing, custom TTL),
 * declare an explicit `$cookie({ key: atom.key, ... })` binding instead.
 */
export class AtomCookiePersistence {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly serverCookies = $inject(ServerCookiesProvider);

  protected readonly onRequest = $hook({
    on: "server:onRequest",
    // Explicit dependency instead of relying on `services` array order in
    // `AlephaServerCookies`: this hook needs `request.cookies`, which is
    // only populated by `ServerCookiesProvider.onRequest`. If that ever ran
    // second, `getCookiesFromContext` would throw, get caught, and log at
    // debug — cookies silently ignored in production with no visible error.
    after: [this.serverCookies],
    handler: ({ request }) => {
      // `alepha.http.request` is not set in the store yet at this point in
      // the request lifecycle (`ServerRouterProvider` sets it only after
      // `server:onRequest` resolves), so the request-scoped cookie jar must
      // be passed explicitly rather than resolved from context.
      for (const atom of this.cookieAtoms()) {
        this.read(atom, request.cookies);
      }
    },
  });

  protected readonly onRegister = $hook({
    on: "state:register",
    handler: ({ atom }) => {
      if (atom.options.persist !== "cookie") {
        return;
      }

      // Only the lazy, mid-request case is handled here — every atom already
      // registered when the request started was swept by `onRequest` above.
      if (this.alepha.store.get("alepha.http.request")) {
        this.read(atom);
      }
    },
  });

  protected readonly onMutate = $hook({
    on: "state:mutate",
    handler: ({ key, value }) => {
      const atom = this.alepha.store.getAtom(String(key));
      if (!atom || atom.options.persist !== "cookie") {
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

  /**
   * Every registered atom declared with `persist: "cookie"`, read live from
   * the state manager's registry.
   */
  protected cookieAtoms(): Array<Atom<any, any>> {
    return this.alepha.store
      .listAtoms()
      .filter((atom) => atom.options.persist === "cookie");
  }

  protected read(atom: Atom<any, any>, cookies?: Cookies): void {
    // Safety net, not a live bug today: an ALS provider is always installed
    // by `core/index.ts` / `core/index.workerd.ts`, so every request already
    // runs inside its own fork. But `store.set(..., { skipEvents: true })`
    // below has no `skipContext`, so if no fork were active,
    // `StateManager.set()` would fall through to writing the APP-LEVEL
    // store — turning one user's cookie value into what every subsequent
    // cookieless request reads. Degrade to "cookie ignored" instead.
    if (!this.alepha.context.exists()) {
      this.log.debug(
        `Skipping cookie read for atom "${atom.key}": no active request context.`,
      );
      return;
    }

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
      // The browser variant of this adapter cannot see APP_NAME (not baked
      // into the client bundle, not part of SSR hydration — see
      // AtomCookiePersistence.browser.ts), so it always reads/writes the
      // bare atom key. Skip the APP_NAME prefix here too — specifically for
      // atom-persisted cookies — so both sides agree on the same cookie
      // name. Every other server cookie ($cookie primitive) still gets the
      // namespace; see ServerCookiesProvider.prefixName.
      prefix: false,
    };
  }
}
