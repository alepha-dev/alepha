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
  type Infer,
  type ZType,
} from "alepha";
import { SecretProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";

import type {
  Cookie,
  CookieBrowserPrefix,
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

  // A browser silently drops a cookie past 4096 bytes of name and value. The
  // difference with this budget leaves room for the prefixed chunk name.
  protected readonly CHUNK_LENGTH = 3800;

  // Every cookie goes back on every request, and request headers are capped:
  // 16 KB in total on Node, 8 KB for the Cookie header on a default nginx. Past
  // that a request fails with 431 or 400, so warn while there is still room.
  protected readonly COOKIE_BUDGET = 6000;

  protected readonly warnedCookies = new Set<string>();

  public readonly onRequest = $hook({
    on: "server:request:before",
    handler: ({ request }) => {
      request.cookies = {
        req: this.cookieParser.parseRequestCookies(
          request.headers.cookie ?? "",
        ),
        res: {},
        https: request.url?.protocol === "https:",
      };
    },
  });

  public readonly onAction = $hook({
    on: "action:request:before",
    handler: ({ request }) => {
      request.cookies = {
        req: this.cookieParser.parseRequestCookies(
          request.headers.cookie ?? "",
        ),
        res: {},
        https: request.url?.protocol === "https:",
      };
    },
  });

  public readonly onSend = $hook({
    on: "server:response:before",
    handler: ({ request }) => {
      if (request.cookies && Object.keys(request.cookies.res).length > 0) {
        const setCookieHeaders = this.cookieParser.serializeResponseCookies(
          request.cookies.res,
          request.url.protocol === "https:",
        );
        if (setCookieHeaders.length > 0) {
          request.reply.headers["set-cookie"] = setCookieHeaders;
        }
        this.warnOverBudget(request.cookies);
      }
    },
  });

  protected getCookiesFromContext(cookies?: Cookies): Cookies {
    // Untracked (#E78): the callers below report what they do with the jar,
    // a named cookie read or a Set-Cookie, which says more than "the request".
    const contextCookies = this.alepha.store.getUntracked(
      "alepha.http.request",
    )?.cookies;
    if (cookies) return cookies;
    if (contextCookies) return contextCookies;
    throw new AlephaError(
      "Cookie context is not available. This method must be called within a server request cycle.",
    );
  }

  /**
   * Namespaces a cookie name with `alepha.name` (lowercased) so that two
   * Alepha apps sharing a cookie jar do not collide.
   *
   * Cookies are scoped by host + path only — never by port — so two apps on
   * `localhost:3000` and `localhost:4000` would otherwise both read/write a
   * cookie literally named `tokens` and silently clobber each other (and,
   * because each encrypts with its own `APP_SECRET`, the foreign cookie fails
   * to decrypt and gets deleted, logging the user out).
   *
   * `alepha.name` is `APP_NAME`, else the build's app name, else `"app"`, so
   * every server cookie is namespaced, whether `APP_NAME` is set or not.
   *
   * Pass `prefix = false` to skip the namespace entirely — used for every
   * cookie the browser also reads or writes (`persist: "cookie"` atoms, the
   * i18n `lang` cookie, the UI preferences): the browser only knows the baked
   * build name, which can differ from the server's runtime `APP_NAME`, so
   * both sides use the bare name. See `CookiePrimitiveOptions.prefix`.
   */
  protected prefixName(name: string, prefix = true): string {
    if (!prefix) return name;
    // A cookie name is an RFC 6265 token: an `APP_NAME` of "My App" would
    // otherwise name the cookie `my app.tokens`, which a browser may refuse.
    const app = this.alepha.name
      .toLowerCase()
      .replace(/[^a-z0-9!#$%&'*+.^_`|~-]/g, "-");
    return `${app}.${name}`;
  }

  /**
   * The name a cookie goes by on this request, and, when a browser prefix
   * applies, the bare name it would have had: a leftover of it is expired.
   *
   * The prefix applies exactly when the response carries `Secure`: over
   * https, with `secure` not off (see `CookieParser.cookieToString`). A
   * browser drops a prefixed cookie without it, so deciding by production
   * alone would stop every sign-in on a built app served over plain http.
   */
  protected resolveName(
    name: string,
    options: {
      prefix?: boolean;
      browserPrefix?: CookieBrowserPrefix;
      secure?: boolean;
    },
    cookies: Cookies,
  ): { name: string; bare?: string } {
    const base = this.prefixName(name, options.prefix !== false);
    if (!options.browserPrefix) {
      return { name: base };
    }
    const secure = options.secure ?? this.alepha.isProduction();
    if (!secure || cookies.https === false) {
      return { name: base };
    }

    const hardened = `${options.browserPrefix}${base}`;
    if (cookies.https === true) {
      return { name: hardened, bare: base };
    }

    // Scheme unknown (a raw Cookie header): a browser holds the prefixed
    // name only if it was set over https, so its presence decides.
    const held =
      hardened in cookies.req ||
      this.chunkNames(hardened, cookies.req).length > 0;
    return { name: held ? hardened : base };
  }

  /**
   * Expire a bare-named copy left from before the prefix, chunks included,
   * so up to 8 KB of dead cookie does not ride along until it expires.
   */
  protected expireBare(
    bare: string | undefined,
    cookies: Cookies,
    scope?: { path?: string; domain?: string },
  ): void {
    if (!bare) {
      return;
    }
    const held = this.chunkNames(bare, cookies.req);
    if (bare in cookies.req) {
      held.push(bare);
    }
    if (held.length > 0) {
      this.expire(held, cookies, scope);
    }
  }

  public getCookie<T extends ZType>(
    name: string,
    options: CookiePrimitiveOptions<T>,
    contextCookies?: Cookies,
  ): Infer<T> | undefined {
    const cookies = this.getCookiesFromContext(contextCookies);
    const prefixed = options.prefix !== false;
    // A cookie is the visitor's: read during a page render, the page is
    // personal (#E78). The seeding done at `server:request:before` runs before any
    // recorder exists and is not counted.
    this.alepha.store.recorder()?.personal({ kind: "cookie", key: name });
    const { name: cookieName, bare } = this.resolveName(name, options, cookies);
    const scope = {
      path: options.path,
      domain: options.domain,
      browserPrefix: options.browserPrefix,
      secure: options.secure,
    };
    this.expireBare(bare, cookies, scope);
    const chunks = prefixed ? this.chunkNames(cookieName, cookies.req) : [];
    let rawValue = cookies.req[cookieName];

    if (!rawValue && chunks.length === 0) return undefined;

    try {
      rawValue = decodeURIComponent(
        rawValue || this.joinChunks(cookieName, cookies),
      );

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
          this.deleteCookie(name, cookies, prefixed, scope);
          return undefined;
        }
        rawValue = value;
      }

      if (options.encrypt) {
        rawValue = this.decrypt(rawValue);
      }

      if (options.compress) {
        rawValue = inflateRawSync(Buffer.from(rawValue, "base64url")).toString(
          "utf8",
        );
      }

      return this.alepha.codec.decode(options.schema, JSON.parse(rawValue));
    } catch (error) {
      this.log.warn(`Failed to parse cookie "${name}"`, error);
      // corrupted or invalid cookie, instruct browser to delete it on next response
      this.deleteCookie(name, cookies, prefixed, scope);
      return undefined;
    }
  }

  public setCookie<T extends ZType>(
    name: string,
    options: CookiePrimitiveOptions<T>,
    data: Infer<T>,
    contextCookies?: Cookies,
  ): void {
    const cookies = this.getCookiesFromContext(contextCookies);
    // A response that sets a cookie is about its visitor (#E78).
    this.alepha.store.recorder()?.personal({ kind: "set-cookie", key: name });
    let value = JSON.stringify(this.alepha.codec.decode(options.schema, data));

    if (options.compress) {
      value = deflateRawSync(value).toString("base64url");
    }

    if (options.encrypt) {
      value = this.encrypt(value);
    }

    if (options.sign) {
      value = this.sign(value) + value;
    }

    const prefixed = options.prefix !== false;
    const { name: cookieName, bare } = this.resolveName(name, options, cookies);
    const encoded = encodeURIComponent(value);

    if (!prefixed && encoded.length > this.CHUNK_LENGTH) {
      throw new AlephaError(
        `Cookie "${name}" encodes to ${encoded.length} bytes, over the ${this.CHUNK_LENGTH} one cookie can hold. It sets \`prefix: false\`, so the browser reads it and it cannot be chunked: store less in it.`,
      );
    }

    const cookie: Cookie = {
      value: encoded,
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

    const written = new Map<string, string>();
    if (encoded.length > this.CHUNK_LENGTH) {
      const count = Math.ceil(encoded.length / this.CHUNK_LENGTH);
      for (let i = 0; i < count; i++) {
        const start = i * this.CHUNK_LENGTH;
        const chunk = encoded.slice(start, start + this.CHUNK_LENGTH);
        written.set(
          `${cookieName}.${i}`,
          i === 0 ? `${count}~${chunk}` : chunk,
        );
      }
    } else {
      written.set(cookieName, encoded);
    }

    // Read before the write, so a chunk this response wrote earlier counts too.
    if (prefixed) {
      const held = this.chunkNames(cookieName, {
        ...cookies.req,
        ...cookies.res,
      });
      if (cookieName in cookies.req || cookieName in cookies.res) {
        held.push(cookieName);
      }
      this.expire(
        held.filter((stale) => !written.has(stale)),
        cookies,
        options,
      );
    }

    this.expireBare(bare, cookies, options);

    for (const [writtenName, part] of written) {
      cookies.res[writtenName] = { ...cookie, value: part };
    }
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
    scope?: {
      path?: string;
      domain?: string;
      browserPrefix?: CookieBrowserPrefix;
      secure?: boolean;
    },
  ): void {
    const cookies = this.getCookiesFromContext(contextCookies);
    this.alepha.store.recorder()?.personal({ kind: "set-cookie", key: name });
    const { name: cookieName, bare } = this.resolveName(
      name,
      { prefix, browserPrefix: scope?.browserPrefix, secure: scope?.secure },
      cookies,
    );
    const chunks = prefix
      ? this.chunkNames(cookieName, { ...cookies.req, ...cookies.res })
      : [];

    this.expire([cookieName, ...chunks], cookies, scope);
    this.expireBare(bare, cookies, scope);
  }

  /**
   * Warns once per cookie this response wrote when everything the client will
   * send from now on passes the budget. Only written cookies are named and
   * remembered: their names are the app's, whereas a request's cookie names are
   * the client's to invent, without limit.
   */
  protected warnOverBudget(cookies: Cookies): void {
    const sent: Record<string, string> = { ...cookies.req };
    const written: Record<string, number> = {};

    for (const [name, cookie] of Object.entries(cookies.res)) {
      if (!cookie || cookie.maxAge === 0) {
        delete sent[name];
        continue;
      }
      sent[name] = cookie.value;
      const cookieName = name.replace(/\.(0|[1-9]\d*)$/, "");
      written[cookieName] = (written[cookieName] ?? 0) + cookie.value.length;
    }

    const total = Object.entries(sent).reduce(
      (sum, [name, value]) => sum + name.length + value.length + 3,
      0,
    );
    if (total <= this.COOKIE_BUDGET) return;

    for (const [name, size] of Object.entries(written)) {
      if (this.warnedCookies.has(name)) continue;
      this.warnedCookies.add(name);
      this.log.warn(
        `Cookies for this client total ${total} bytes, near the 8 KB a default nginx accepts and the 16 KB Node does. "${name}" is ${size} bytes of that. A large value belongs in a server-side session, with only its ID in the cookie${name.endsWith(".tokens") ? ": turn on serverAuthOptions.sessionStore" : ""}.`,
      );
    }
  }

  protected expire(
    names: string[],
    cookies: Cookies,
    scope?: { path?: string; domain?: string },
  ): void {
    for (const name of names) {
      cookies.res[name] = {
        value: "",
        path: scope?.path ?? "/",
        domain: scope?.domain,
        maxAge: 0,
        // A browser refuses any Set-Cookie for an `__Http-` or
        // `__Host-Http-` name without HttpOnly, deletions included: without
        // it the expiry is dropped and the cookie lives on (a logout that
        // signed nobody out).
        httpOnly: /^(__Http-|__Host-Http-)/.test(name) || undefined,
      };
    }
  }

  /**
   * The chunks of `cookieName` among `jar`, found by name rather than by
   * walking from `.0`, so a chunk past a gap is still found. Only a canonical
   * index counts: `<name>.01` and `<name>.0x` are someone else's cookies.
   */
  protected chunkNames(
    cookieName: string,
    jar: Record<string, unknown>,
  ): string[] {
    const prefix = `${cookieName}.`;
    return Object.keys(jar).filter(
      (key) =>
        key.startsWith(prefix) &&
        /^(0|[1-9]\d*)$/.test(key.slice(prefix.length)),
    );
  }

  /**
   * Joins a chunked cookie back into its encoded value. The first chunk opens
   * with the chunk count, `<count>~<chunk>`: two requests racing cannot expire
   * what each other's response writes, so a shorter write can land on top of a
   * longer one and leave its last chunks behind. Those are ignored here, and the
   * next write expires them. A read must not: an expiry is only safe beside the
   * rewrite it belongs to, and alone it could take a chunk a concurrent response
   * has just written.
   *
   * A missing chunk or count throws, since the value cannot be whole.
   */
  protected joinChunks(cookieName: string, cookies: Cookies): string {
    const [, count, first] =
      /^(\d+)~(.*)$/.exec(cookies.req[`${cookieName}.0`] ?? "") ?? [];
    if (!count) {
      throw new AlephaError(`Cookie "${cookieName}" has no chunk count.`);
    }

    let value = first;
    for (let i = 1; i < Number(count); i++) {
      const chunk = cookies.req[`${cookieName}.${i}`];
      if (chunk === undefined) {
        throw new AlephaError(`Cookie "${cookieName}" lost its chunk ${i}.`);
      }
      value += chunk;
    }
    return value;
  }

  // --- Crypto & Parsing ---

  /**
   * Encrypt a value with the key an `encrypt: true` cookie uses
   * (AES-256-GCM, from `APP_SECRET`): for a value kept server-side that must
   * be no less protected than it was in the cookie.
   */
  public encryptValue(text: string): string {
    return this.encrypt(text);
  }

  /**
   * The inverse of {@link ServerCookiesProvider.encryptValue}. Throws on a
   * value that was altered or encrypted with another key.
   */
  public decryptValue(text: string): string {
    return this.decrypt(text);
  }

  protected encrypt(text: string): string {
    const iv = randomBytes(this.IV_LENGTH);
    const cipher = createCipheriv(this.ALGORITHM, this.deriveKey(), iv);
    const encrypted = Buffer.concat([
      cipher.update(text, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]).toString("base64url");
  }

  protected decrypt(encryptedText: string): string {
    const data = Buffer.from(encryptedText, "base64url");
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
