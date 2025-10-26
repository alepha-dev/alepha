import {
  $inject,
  Alepha,
  AlephaError,
  createDescriptor,
  Descriptor,
  KIND,
  type Static,
  type TSchema,
} from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { CookieParser } from "../services/CookieParser.ts";
import type {
  AbstractCookieDescriptor,
  Cookie,
  CookieDescriptorOptions,
  Cookies,
} from "./$cookie.ts";

export const $cookie = <T extends TSchema>(
  options: CookieDescriptorOptions<T>,
): AbstractCookieDescriptor<T> => {
  return createDescriptor(BrowserCookieDescriptor<T>, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export class BrowserCookieDescriptor<T extends TSchema>
  extends Descriptor<CookieDescriptorOptions<T>>
  implements AbstractCookieDescriptor<T>
{
  protected cookieParser = $inject(CookieParser);
  protected alepha = $inject(Alepha);
  protected dateTimeProvider = $inject(DateTimeProvider);
  protected cookie?: Cookie;

  public get name(): string {
    return this.options.name ?? `${this.config.propertyKey}`;
  }

  public set(data: Static<T>): void {
    const value = JSON.stringify(
      this.alepha.codec.decode(this.options.schema, data),
    );
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

  public get(options?: { cookies?: Cookies }): Static<T> | undefined {
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

    return this.alepha.codec.decode(this.options.schema, JSON.parse(rawValue));
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

$cookie[KIND] = BrowserCookieDescriptor;
