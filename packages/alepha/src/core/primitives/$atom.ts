import type { z as zod } from "zod";
import { KIND } from "../constants/KIND.ts";
import { AlephaError } from "../errors/AlephaError.ts";
import type { Static, TObject } from "../providers/TypeProvider.ts";
import type { ZType } from "../providers/ZodProvider.ts";

/**
 * Define an atom for state management.
 *
 * Atom lets you define a piece of state with a name, schema, and default value.
 *
 * By default, Alepha state is just a simple key-value store.
 * Using atoms allows you to have type safety, validation, and default values for your state.
 *
 * You control how state is structured and validated.
 *
 * Features:
 * - Schema validation on every write (invalid writes throw)
 * - Default value for initial state
 * - Automatic getter access in services with {@link $state}
 * - SSR support (server state automatically serialized and hydrated on client)
 * - React integration (useStore / useSelector hooks for automatic re-renders)
 * - Derived values with {@link $computed} (useComputed hook)
 * - Persistence adapters: cookie (SSR-safe), localStorage, sessionStorage
 * - `serverOnly` flag to keep an atom out of the hydration payload
 * - reset / watch helpers on the state manager
 * - Documentation generation & devtools integration (mutation log)
 *
 * Common use cases:
 * - user preferences
 * - feature flags
 * - configuration options
 * - session data
 *
 * Atom must contain only serializable data.
 * Avoid storing complex objects like class instances, functions, or DOM elements.
 * If you need to store complex data, consider using identifiers or references instead.
 */
export const $atom = <T extends ZType, N extends string>(
  options: AtomOptions<T, N>,
): Atom<T, N> => {
  if (options.serverOnly && options.persist) {
    throw new AlephaError(
      `Atom "${options.name}" declares both serverOnly and persist: "${options.persist}", ` +
        "which is a contradiction: serverOnly only guarantees exclusion from the SSR " +
        "hydration payload, while every persist adapter (cookie, localStorage, " +
        "sessionStorage) targets the browser by definition — cookie persistence ships " +
        "the value in a Set-Cookie response header, and web-storage persistence IS the " +
        "browser. Combining them silently leaks the value through the persistence " +
        "channel instead of the hydration payload. Remove `serverOnly` or `persist` from " +
        `atom "${options.name}".`,
    );
  }
  return new Atom<T, N>(options);
};

/**
 * Persistence adapter for an atom.
 */
export type AtomPersist = "cookie" | "localStorage" | "sessionStorage";

export type AtomOptions<T extends ZType, N extends string> = {
  name: N;
  schema: T;
  description?: string;

  /**
   * Persist this atom outside the in-memory store.
   *
   * - `"cookie"` — synced to an HTTP cookie by the `alepha/server/cookies`
   *   module. Works on the server AND in the browser, so it is the only
   *   correct adapter for SSR apps: the server reads it while rendering and
   *   the first paint matches the persisted state.
   * - `"localStorage"` / `"sessionStorage"` — browser Web Storage. Fine for
   *   pure SPA apps. The server cannot see these values; registering such
   *   an atom during SSR logs a warning.
   *
   * Values are validated against the schema when read back; invalid or
   * corrupted entries are discarded and the default is used.
   *
   * **Security: cookie-persisted atoms are attacker-controlled.** The
   * cookie written by `persist: "cookie"` is unsigned, unencrypted, and
   * freely writable by any client-side script (`AtomCookiePersistence`'s
   * `cookieOptions()` sets no `sign`, `encrypt`, or `httpOnly`) — a request
   * can present any value it wants for it. Never persist trust-bearing
   * state — user ids, roles, entitlements, permissions — in a
   * `persist: "cookie"` atom. If you need a signed, encrypted, and/or
   * `httpOnly` cookie, declare an explicit
   * `$cookie({ key: atom.key, sign: true, encrypt: true, httpOnly: true, ... })`
   * binding instead — that is the escape hatch for trust-bearing values.
   */
  persist?: AtomPersist;

  /**
   * Keep this atom's *value* server-side. Two mechanisms honour the flag,
   * and together they are the whole of what it promises:
   *
   * 1. `StateManager.exportAtoms()` skips the atom, so the value is never
   *    written into the `<script id="__ssr">` JSON block serialized into
   *    the HTML payload.
   * 2. DevTools (`DevToolsMetadataProvider.getAtoms()`) omits
   *    `defaultValue` and `currentValue` from `/metadata`. The atom is
   *    still listed with its name, description, and schema — a developer
   *    can see that it exists and what shape it has, just not what is in
   *    it.
   *
   * It says nothing about any other channel a value can reach the browser
   * through: an `$action` that returns the value still returns it.
   *
   * **Only request-scoped writes were ever at risk.** `exportAtoms` is
   * called with scope `"current"`, which reads the current ALS layer alone
   * — no parent walk, no app-store fallback. An atom configured at boot
   * (every `*Options` atom) therefore never reached the payload to begin
   * with, so adding the flag there changes no runtime behaviour; it
   * documents intent and closes the door on a future in-request
   * `store.set`. The flag only bites for atoms genuinely written inside a
   * request — `currentResourceAtom`, `currentTenantAtom`.
   *
   * **Cannot be combined with `persist`.** Every persistence adapter
   * (`"cookie"`, `"localStorage"`, `"sessionStorage"`) targets the browser
   * by definition — cookie persistence ships the value in a `Set-Cookie`
   * response header, and web-storage persistence IS the browser. Declaring
   * `serverOnly: true` together with any `persist` value throws
   * `AlephaError` at `$atom()` call time, because the persistence channel
   * would leak the exact value `serverOnly` is meant to keep server-side.
   *
   * Use `serverOnly` for atoms that may hold secrets or internal
   * request-scoped state that must never leave the server, and never pair
   * it with `persist`.
   *
   * **Never make a `serverOnly` atom a dependency of a `$computed` that the
   * browser reads through `useComputed`.** A computed is re-derived, never
   * serialized: the server derives it from the atom's real value, and the
   * browser — which never received that value — re-derives it from the
   * atom's default. The two disagree, producing a React hydration mismatch
   * and a silently wrong value from then on. Keep such a computed
   * server-side (`alepha.store.get`), or derive it from atoms that ship.
   */
  serverOnly?: boolean;
} & (T extends zod.ZodOptional<any>
  ? {
      default?: Static<T>;
    }
  : {
      default: Static<T>;
    });

export class Atom<T extends ZType = TObject, N extends string = string> {
  public readonly options: AtomOptions<T, N>;

  public get schema(): T {
    return this.options.schema;
  }

  public get key(): N {
    return this.options.name;
  }

  constructor(options: AtomOptions<T, N>) {
    this.options = options;
  }
}

$atom[KIND] = "atom";

export type TAtomObject = ZType;
export type AtomStatic<T extends ZType> =
  T extends zod.ZodOptional<any> ? Static<T> | undefined : Static<T>;
