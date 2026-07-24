import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import {
  $hook,
  $inject,
  Alepha,
  AlephaError,
  type Static,
  type TSchema,
} from "alepha";
import { SecretProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import type {
  Cookie,
  CookiePrimitiveOptions,
  Cookies,
} from "../primitives/$cookie.ts";
import { CookieParser } from "../services/CookieParser.ts";

export class ServerCookiesProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly cookieParser = $inject(CookieParser);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly secretProvider = $inject(SecretProvider);

  // crypto constants
  protected readonly ALGORITHM = "aes-256-gcm";
  protected readonly IV_LENGTH = 16; // For GCM
  protected readonly AUTH_TAG_LENGTH = 16;
  protected readonly SIGNATURE_LENGTH = 32; // For SHA256

  public readonly onRequest = $hook({
    on: "server:onRequest",
    handler: ({ request }) => {
      request.cookies = {
        req: this.cookieParser.parseRequestCookies(
          request.headers.cookie ?? "",
        ),
        res: {},
      };
    },
  });

  public readonly onAction = $hook({
    on: "action:onRequest",
    handler: ({ request }) => {
      request.cookies = {
        req: this.cookieParser.parseRequestCookies(
          request.headers.cookie ?? "",
        ),
        res: {},
      };
    },
  });

  public readonly onSend = $hook({
    on: "server:onSend",
    handler: ({ request }) => {
      if (request.cookies && Object.keys(request.cookies.res).length > 0) {
        const setCookieHeaders = this.cookieParser.serializeResponseCookies(
          request.cookies.res,
          request.url.protocol === "https:",
        );
        if (setCookieHeaders.length > 0) {
          request.reply.headers["set-cookie"] = setCookieHeaders;
        }
      }
    },
  });

  protected getCookiesFromContext(cookies?: Cookies): Cookies {
    const contextCookies = this.alepha.store.get(
      "alepha.http.request",
    )?.cookies;
    if (cookies) return cookies;
    if (contextCookies) return contextCookies;
    throw new AlephaError(
      "Cookie context is not available. This method must be called within a server request cycle.",
    );
  }

  /**
   * Namespaces a cookie name with the app's `APP_NAME` (lowercased) so that
   * two Alepha apps sharing a cookie jar do not collide.
   *
   * Cookies are scoped by host + path only — never by port — so two apps on
   * `localhost:3000` and `localhost:4000` would otherwise both read/write a
   * cookie literally named `tokens` and silently clobber each other (and,
   * because each encrypts with its own `APP_SECRET`, the foreign cookie fails
   * to decrypt and gets deleted, logging the user out).
   *
   * When `APP_NAME` is unset the name is returned unchanged, so existing
   * single-app deployments keep their current cookie names. Same convention as
   * the `APP_NAME` prefix used by R2 storage and server-timing.
   *
   * Pass `prefix = false` to skip the namespace entirely — used for
   * `persist: "cookie"` atoms, whose browser-side counterpart cannot see
   * `APP_NAME` and therefore always uses the bare name. See
   * `CookiePrimitiveOptions.prefix`.
   */
  protected prefixName(name: string, prefix = true): string {
    if (!prefix) return name;
    const app = this.alepha.env.APP_NAME;
    if (!app) return name;
    return `${String(app).toLowerCase()}.${name}`;
  }

  public getCookie<T extends TSchema>(
    name: string,
    options: CookiePrimitiveOptions<T>,
    contextCookies?: Cookies,
  ): Static<T> | undefined {
    const cookies = this.getCookiesFromContext(contextCookies);
    const prefixed = options.prefix !== false;
    let rawValue = cookies.req[this.prefixName(name, prefixed)];

    if (!rawValue) return undefined;

    try {
      rawValue = decodeURIComponent(rawValue);

      if (options.sign) {
        const signature = rawValue.substring(0, this.SIGNATURE_LENGTH * 2);
        const value = rawValue.substring(this.SIGNATURE_LENGTH * 2);
        const expectedSignature = this.sign(value);

        if (
          !timingSafeEqual(
            Buffer.from(signature, "hex"),
            Buffer.from(expectedSignature, "hex"),
          )
        ) {
          this.log.warn(`Invalid signature for cookie "${name}".`);
          return undefined;
        }
        rawValue = value;
      }

      if (options.encrypt) {
        rawValue = this.decrypt(rawValue);
      }

      if (options.compress) {
        rawValue = inflateRawSync(Buffer.from(rawValue, "base64")).toString(
          "utf8",
        );
      }

      return this.alepha.codec.decode(options.schema, JSON.parse(rawValue));
    } catch (error) {
      this.log.warn(`Failed to parse cookie "${name}"`, error);
      // corrupted or invalid cookie, instruct browser to delete it on next response
      this.deleteCookie(name, cookies, prefixed);
      return undefined;
    }
  }

  public setCookie<T extends TSchema>(
    name: string,
    options: CookiePrimitiveOptions<T>,
    data: Static<T>,
    contextCookies?: Cookies,
  ): void {
    const cookies = this.getCookiesFromContext(contextCookies);
    let value = JSON.stringify(this.alepha.codec.decode(options.schema, data));

    if (options.compress) {
      value = deflateRawSync(value).toString("base64");
    }

    if (options.encrypt) {
      value = this.encrypt(value);
    }

    if (options.sign) {
      value = this.sign(value) + value;
    }

    const cookie: Cookie = {
      value: encodeURIComponent(value),
      path: options.path ?? "/",
      // "lax" is correct here — "strict" would break OAuth flows because OAuth callbacks
      // are top-level redirects from the IdP, and strict cookies are not sent on cross-site
      // top-level navigations. "lax" is Chrome's own default and the industry standard.
      sameSite: options.sameSite ?? "lax",
      secure: options.secure ?? this.alepha.isProduction(),
      httpOnly: options.httpOnly,
      domain: options.domain,
    };

    if (options.ttl) {
      cookie.maxAge = this.dateTimeProvider.duration(options.ttl).as("seconds");
    }

    cookies.res[this.prefixName(name, options.prefix !== false)] = cookie;
  }

  /**
   * A browser only drops a cookie when the deletion carries the same `Path`
   * and `Domain` it was written with, so the scope has to be forwarded here.
   * Without `scope` this emits the historical bare `Path=/` deletion, which
   * silently does nothing for a cookie declared with any other path.
   */
  public deleteCookie(
    name: string,
    contextCookies?: Cookies,
    prefix = true,
    scope?: { path?: string; domain?: string },
  ): void {
    const cookies = this.getCookiesFromContext(contextCookies);

    cookies.res[this.prefixName(name, prefix)] = {
      value: "",
      path: scope?.path ?? "/",
      domain: scope?.domain,
      maxAge: 0,
    };
  }

  // --- Crypto & Parsing ---

  protected encrypt(text: string): string {
    const iv = randomBytes(this.IV_LENGTH);
    const cipher = createCipheriv(this.ALGORITHM, this.deriveKey(), iv);
    const encrypted = Buffer.concat([
      cipher.update(text, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]).toString("base64");
  }

  protected decrypt(encryptedText: string): string {
    const data = Buffer.from(encryptedText, "base64");
    const iv = data.subarray(0, this.IV_LENGTH);
    const authTag = data.subarray(
      this.IV_LENGTH,
      this.IV_LENGTH + this.AUTH_TAG_LENGTH,
    );

    const encrypted = data.subarray(this.IV_LENGTH + this.AUTH_TAG_LENGTH);
    const decipher = createDecipheriv(this.ALGORITHM, this.deriveKey(), iv);

    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  }

  /**
   * Derives a 32-byte key from APP_SECRET via SHA-256.
   * Accepts any string length — no padding or truncation needed.
   */
  protected deriveKey(): Buffer {
    return createHash("sha256").update(this.secretProvider.secretKey).digest();
  }

  protected sign(data: string): string {
    return createHmac("sha256", this.deriveKey()).update(data).digest("hex");
  }
}
