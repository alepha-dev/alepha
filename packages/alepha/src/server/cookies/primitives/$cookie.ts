import {
  $inject,
  createPrimitive,
  type Infer,
  KIND,
  Primitive,
  type ZType,
} from "alepha";
import type { DurationLike } from "alepha/datetime";

import { ServerCookiesProvider } from "../providers/ServerCookiesProvider.ts";

/**
 * Declares a type-safe, configurable HTTP cookie.
 * This primitive provides methods to get, set, and delete the cookie
 * within the server request/response cycle.
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
   * the `APP_NAME` cookie-name namespace applied by
   * `ServerCookiesProvider.prefixName()`.
   *
   * Used by `AtomCookiePersistence` so the cookie name the server
   * reads/writes for a `persist: "cookie"` atom matches the bare name its
   * browser variant uses — `APP_NAME` is not reachable client-side (not
   * baked into the client bundle, not part of SSR hydration), so the
   * browser can only ever use the bare atom key.
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
  protected readonly serverCookiesProvider = $inject(ServerCookiesProvider);

  protected onInit() {
    if (this.options.key) {
      this.alepha.events.on("state:mutate", ({ key, value }) => {
        if (key === this.options.key) {
          this.set(value);
        }
      });
      this.alepha.events.on("server:onRequest", ({ request }) => {
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
