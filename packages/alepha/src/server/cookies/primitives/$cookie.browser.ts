import {
  $inject,
  Alepha,
  AlephaError,
  createPrimitive,
  type Infer,
  KIND,
  Primitive,
  type ZType,
} from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { CookieParser } from "../services/CookieParser.ts";
import type {
  AbstractCookiePrimitive,
  Cookie,
  CookiePrimitiveOptions,
  Cookies,
} from "./$cookie.ts";

/**
 * Creates a browser-side cookie primitive for client-side cookie management.
 *
 * Browser-specific version of $cookie that uses document.cookie API. Supports type-safe
 * cookie operations with schema validation but excludes encryption/signing (use server-side
 * $cookie for secure operations).
 *
 * **Note**: This is the browser version - encryption, signing, and compression are not supported.
 *
 * @example
 * ```ts
 * class ClientCookies {
 *   preferences = $cookie({
 *     name: "user-prefs",
 *     schema: z.object({ theme: z.text(), language: z.text() }),
 *     ttl: [30, "days"]
 *   });
 *
 *   savePreferences() {
 *     this.preferences.set({ theme: "dark", language: "en" });
 *   }
 *
 *   getPreferences() {
 *     return this.preferences.get() ?? { theme: "light", language: "en" };
 *   }
 * }
 * ```
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
  return createPrimitive(BrowserCookiePrimitive<T>, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export class BrowserCookiePrimitive<T extends ZType>
  extends Primitive<CookiePrimitiveOptions<T>>
  implements AbstractCookiePrimitive<T>
{
  protected cookieParser = $inject(CookieParser);
  protected alepha = $inject(Alepha);
  protected dateTimeProvider = $inject(DateTimeProvider);
  protected cookie?: Cookie;

  protected onInit() {
    if (this.options.key) {
      this.alepha.events.on("state:mutate", ({ key, value }) => {
        if (key === this.options.key) {
          this.set(value);
        }
      });
      this.alepha.events.on("configure", () => {
        try {
          const value = this.get();
          if (value !== undefined) {
            this.alepha.set(this.options.key as any, value);
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

  public set(data: Infer<T>): void {
    const value = JSON.stringify(this.alepha.codec.decode(this.schema, data));
    const options = this.options;

    if (options.compress) {
      throw new AlephaError("Compression is not supported in browser cookies.");
    }

    if (options.encrypt) {
      throw new AlephaError("Encryption is not supported in browser cookies.");
    }

    if (options.sign) {
      throw new AlephaError("Signing is not supported in browser cookies.");
    }

    const cookie: Cookie = {
      value: encodeURIComponent(value),
      path: options.path ?? "/",
      sameSite: options.sameSite ?? "lax",
      secure: false,
      httpOnly: false,
      domain: options.domain,
    };

    if (options.ttl) {
      cookie.maxAge = this.dateTimeProvider.duration(options.ttl).as("seconds");
    }

    // biome-ignore lint/suspicious/noDocumentCookie: ...
    document.cookie = this.cookieParser.cookieToString(this.name, cookie);
  }

  public get(options?: { cookies?: Cookies }): Infer<T> | undefined {
    const cookie = this.cookieParser.parseRequestCookies(document.cookie)[
      this.name
    ];
    if (!cookie) {
      return undefined;
    }

    const rawValue = decodeURIComponent(cookie);

    if (this.options.compress) {
      throw new AlephaError("Compression is not supported in browser cookies.");
    }

    if (this.options.encrypt) {
      throw new AlephaError("Encryption is not supported in browser cookies.");
    }

    if (this.options.sign) {
      throw new AlephaError("Signing is not supported in browser cookies.");
    }

    return this.alepha.codec.decode(this.schema, JSON.parse(rawValue));
  }

  public del(): void {
    const options = this.options;
    const cookie: Cookie = {
      value: "",
      path: options.path ?? "/",
      sameSite: options.sameSite ?? "lax",
      secure: false,
      httpOnly: false,
      domain: options.domain,
      maxAge: 0, // Set maxAge to 0 to delete the cookie
    };

    // biome-ignore lint/suspicious/noDocumentCookie: ...
    document.cookie = this.cookieParser.cookieToString(this.name, cookie);
  }
}

$cookie[KIND] = BrowserCookiePrimitive;
