import {
  $inject,
  createPrimitive,
  KIND,
  Primitive,
  type Static,
  type TSchema,
} from "alepha";
import type { DurationLike } from "alepha/datetime";
import { ServerCookiesProvider } from "../providers/ServerCookiesProvider.ts";

/**
 * Declares a type-safe, configurable HTTP cookie.
 * This primitive provides methods to get, set, and delete the cookie
 * within the server request/response cycle.
 */
export const $cookie = <T extends TSchema>(
  options: CookiePrimitiveOptions<T>,
): AbstractCookiePrimitive<T> => {
  return createPrimitive(CookiePrimitive<T>, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface CookiePrimitiveOptions<T extends TSchema> {
  /** The schema for the cookie's value, used for validation and type safety. */
  schema: T;

  /** The name of the cookie. */
  name?: string;

  /** The cookie's path. Defaults to "/". */
  path?: string;

  /** Time-to-live for the cookie. Maps to `Max-Age`. */
  ttl?: DurationLike;

  /** If true, the cookie is only sent over HTTPS. Defaults to true in production. */
  secure?: boolean;

  /** If true, the cookie cannot be accessed by client-side scripts. */
  httpOnly?: boolean;

  /** SameSite policy for the cookie. Defaults to "lax". */
  sameSite?: "strict" | "lax" | "none";

  /** The domain for the cookie. */
  domain?: string;

  /** If true, the cookie value will be compressed using zlib. */
  compress?: boolean;

  /** If true, the cookie value will be encrypted. Requires `COOKIE_SECRET` env var. */
  encrypt?: boolean;

  /** If true, the cookie will be signed to prevent tampering. Requires `COOKIE_SECRET` env var. */
  sign?: boolean;
}

export interface AbstractCookiePrimitive<T extends TSchema> {
  readonly name: string;
  readonly options: CookiePrimitiveOptions<T>;
  set(
    value: Static<T>,
    options?: { cookies?: Cookies; ttl?: DurationLike },
  ): void;
  get(options?: { cookies?: Cookies }): Static<T> | undefined;
  del(options?: { cookies?: Cookies }): void;
}

export class CookiePrimitive<T extends TSchema>
  extends Primitive<CookiePrimitiveOptions<T>>
  implements AbstractCookiePrimitive<T>
{
  protected readonly serverCookiesProvider = $inject(ServerCookiesProvider);

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
    value: Static<T>,
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
  public get(options?: { cookies?: Cookies }): Static<T> | undefined {
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
    this.serverCookiesProvider.deleteCookie(this.name, options?.cookies);
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
