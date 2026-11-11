import type { PrimitiveSide } from "alepha";
import {
  $inject,
  createPrimitive,
  type Infer,
  Primitive,
  type ZType,
} from "alepha";
import type { DurationLike } from "alepha/datetime";
import { KIND } from "alepha/internal";

import { ServerCookiesProvider } from "../providers/ServerCookiesProvider.ts";

/**
 * Declares a type-safe, configurable HTTP cookie.
 * This primitive provides methods to get, set, and delete the cookie
 * within the server request/response cycle.
 *
 * A browser silently drops a cookie past 4 KB, so a server cookie is chunked
 * automatically: a value that encodes to more than 3,800 bytes is written as
 * `<name>.0`, `<name>.1`, ... and joined back on read, with stale chunks expired
 * on every set and delete. A name ending in `.<number>` is therefore reserved. A
 * `prefix: false` cookie is read by the browser, so it is never chunked: writing
 * one over that size throws.
 *
 * Chunking does not lift the limits on request headers, and every chunk goes back
 * on every request. Node caps all of a request's headers at 16 KB and a default
 * nginx its `Cookie` header at 8 KB, past which a request fails with 431 or 400.
 * The server logs a warning when a client's cookies pass about 6 KB. A very large
 * value, such as a big token set, belongs in a server-side session with only an
 * ID in the cookie.
 */
export const $cookie = <T extends ZType>(
  options: CookiePrimitiveOptions<T>,
  extendedOptions?: Omit<CookiePrimitiveOptions<T>, "schema">,
): AbstractCookiePrimitive<T> => {
  if (extendedOptions) {
    options = {
      key: options.key,
      schema: options.schema,
      ...extendedOptions,
    };
  }
  return createPrimitive(CookiePrimitive<T>, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface CookiePrimitiveOptions<T extends ZType> {
  /**
   * The schema for the cookie's value, used for validation and type safety.
   */
  schema: T;

  /**
   * The name of the cookie.
   */
  name?: string;

  /**
   * The cookie's path. Defaults to "/".
   */
  path?: string;

  /**
   * Time-to-live for the cookie. Maps to `Max-Age`.
   */
  ttl?: DurationLike;

  /**
   * If true, the cookie is only sent over HTTPS. Defaults to true in production.
   */
  secure?: boolean;

  /**
   * If true, the cookie cannot be accessed by client-side scripts.
   */
  httpOnly?: boolean;

  /**
   * SameSite policy for the cookie. Defaults to "lax".
   */
  sameSite?: "strict" | "lax" | "none";

  /**
   * The domain for the cookie.
   */
  domain?: string;

  /**
   * If true, the cookie value will be compressed using zlib.
   */
  compress?: boolean;

  /**
   * If true, the cookie value will be encrypted. The key derives from
   * `APP_SECRET` (via `SecretProvider`).
   */
  encrypt?: boolean;

  /**
   * If true, the cookie will be signed to prevent tampering. The key derives
   * from `APP_SECRET` (via `SecretProvider`).
   */
  sign?: boolean;

  /**
   * Optional key to link this cookie to an Atom, enabling automatic synchronization between the cookie and the Atom's state.
   */
  key?: string;

  /**
   * Internal escape hatch: when explicitly set to `false`, the server skips
   * the `alepha.name` cookie-name namespace applied by
   * `ServerCookiesProvider.prefixName()`.
   *
   * Used by `AtomCookiePersistence` so the cookie name the server
   * reads/writes for a `persist: "cookie"` atom matches the bare name its
   * browser variant uses — the server's runtime `APP_NAME` is not reachable
   * client-side (not bundled, not part of SSR hydration), so the browser can
   * only ever use the bare atom key.
   *
   * Application code declaring `$cookie(...)` directly should leave this
   * unset — it defaults to `true` (prefixed), matching every other cookie.
   */
  prefix?: boolean;
}

export interface AbstractCookiePrimitive<T extends ZType> {
  readonly name: string;
  readonly options: CookiePrimitiveOptions<T>;
  set(
    value: Infer<T>,
    options?: { cookies?: Cookies; ttl?: DurationLike },
  ): void;
  get(options?: { cookies?: Cookies }): Infer<T> | undefined;
  del(options?: { cookies?: Cookies }): void;
}

export class CookiePrimitive<T extends ZType>
  extends Primitive<CookiePrimitiveOptions<T>>
  implements AbstractCookiePrimitive<T>
{
  /**
   * `boot` for the pure controller rule: a keyed cookie registers listeners at init.
   */
  public static override readonly side: PrimitiveSide = "boot";

  protected readonly serverCookiesProvider = $inject(ServerCookiesProvider);

  protected onInit() {
    if (this.options.key) {
      // A cookie is the visitor's: the atom it feeds is personal, unless the
      // atom itself says `personal: false` (#E78).
      this.alepha.store.markPersonal(this.options.key);
      this.alepha.events.on("state:mutated", ({ key, value }) => {
        if (key === this.options.key) {
          this.set(value);
        }
      });
      this.alepha.events.on("server:request:before", ({ request }) => {
        try {
          const value = this.get(request);
          if (value !== undefined) {
            this.alepha.store.set(this.options.key as any, value, {
              skipEvents: true,
            });
          }
        } catch {}
      });
    }
  }

  public get schema(): T {
    return this.options.schema;
  }

  public get name(): string {
    return this.options.name ?? `${this.config.propertyKey}`;
  }

  /**
   * Sets the cookie with the given value in the current request's response.
   */
  public set(
    value: Infer<T>,
    options?: { cookies?: Cookies; ttl?: DurationLike },
  ): void {
    this.serverCookiesProvider.setCookie(
      this.name,
      {
        ...this.options,
        ttl: options?.ttl ?? this.options.ttl,
      },
      value,
      options?.cookies,
    );
  }

  /**
   * Gets the cookie value from the current request. Returns undefined if not found or invalid.
   */
  public get(options?: { cookies?: Cookies }): Infer<T> | undefined {
    return this.serverCookiesProvider.getCookie(
      this.name,
      this.options,
      options?.cookies,
    );
  }

  /**
   * Deletes the cookie in the current request's response.
   */
  public del(options?: { cookies?: Cookies }): void {
    // Forward the declared scope: the browser matches Path and Domain when
    // deciding whether a Set-Cookie deletes an existing cookie.
    this.serverCookiesProvider.deleteCookie(
      this.name,
      options?.cookies,
      this.options.prefix !== false,
      { path: this.options.path, domain: this.options.domain },
    );
  }
}

$cookie[KIND] = CookiePrimitive;

// ---------------------------------------------------------------------------------------------------------------------

export interface Cookies {
  req: Record<string, string>;
  res: Record<string, Cookie | null>;
}

export interface Cookie {
  value: string;
  path?: string;
  maxAge?: number;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "strict" | "lax" | "none";
  domain?: string;
}
