import { createHash } from "node:crypto";

import { $atom, $hook, $inject, $store, Alepha, type Infer, z } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Helmet security headers configuration atom
 */
export const helmetOptions = $atom({
  name: "alepha.server.helmet.options",
  schema: z.object({
    disabled: z
      .boolean()
      .describe("Disable security headers entirely.")
      .optional(),
    isSecure: z.boolean().optional(),
    strictTransportSecurity: z
      .object({
        maxAge: z.number().optional(),
        includeSubDomains: z.boolean().optional(),
        preload: z.boolean().optional(),
      })
      .optional(),
    xContentTypeOptions: z.boolean().optional(),
    xFrameOptions: z.enum(["DENY", "SAMEORIGIN"]).optional(),
    xXssProtection: z.boolean().optional(),
    contentSecurityPolicy: z
      .object({
        directives: z.record(z.string(), z.any()).optional(),
      })
      .optional(),
    referrerPolicy: z
      .enum([
        "no-referrer",
        "no-referrer-when-downgrade",
        "origin",
        "origin-when-cross-origin",
        "same-origin",
        "strict-origin",
        "strict-origin-when-cross-origin",
        "unsafe-url",
      ])
      .optional(),
  }),
  default: {
    strictTransportSecurity: { maxAge: 15552000, includeSubDomains: true },
    xFrameOptions: "SAMEORIGIN",
    xXssProtection: false,
    referrerPolicy: "strict-origin-when-cross-origin",
  },
  serverOnly: true,
});

export type HelmetOptions = Infer<typeof helmetOptions.schema>;

declare module "alepha" {
  interface State {
    [helmetOptions.key]: HelmetOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export type CspDirective = string | string[];

export interface CspDirectives {
  "default-src"?: CspDirective;
  "script-src"?: CspDirective;
  "style-src"?: CspDirective;
  "img-src"?: CspDirective;
  "connect-src"?: CspDirective;
  "font-src"?: CspDirective;
  "object-src"?: CspDirective;
  "media-src"?: CspDirective;
  "frame-src"?: CspDirective;
  sandbox?: CspDirective | boolean;
  "report-uri"?: string;
  "child-src"?: CspDirective;
  "form-action"?: CspDirective;
  "frame-ancestors"?: CspDirective;
  "plugin-types"?: CspDirective;
  "base-uri"?: CspDirective;
  [key: string]: CspDirective | undefined | boolean;
}

export interface CspOptions {
  /**
   * The policy to send. Omit it to get {@link
   * ServerHelmetProvider.defaultCspDirectives}; pass an EMPTY object to send
   * no `Content-Security-Policy` at all, which is how CSP is turned off
   * without turning off the rest of helmet.
   */
  directives?: CspDirectives;
}

export interface HstsOptions {
  maxAge?: number;
  includeSubDomains?: boolean;
  preload?: boolean;
}

/**
 * Provides a configurable way to apply essential HTTP security headers
 * to every server response, without external dependencies.
 */
export class ServerHelmetProvider {
  public static readonly id: string = "alepha.server.ServerHelmetProvider";
  protected readonly alepha = $inject(Alepha);

  /**
   * The configuration options loaded from the atom.
   */
  protected readonly options = $store(helmetOptions);

  protected defaultCspDirectives(): CspDirectives {
    return {
      "default-src": ["'self'"],
      "base-uri": ["'self'"],
      "font-src": ["'self'", "https:", "data:"],
      "form-action": ["'self'"],
      "frame-ancestors": ["'self'"],
      "img-src": ["'self'", "data:"],
      "object-src": ["'none'"],
      "script-src": ["'self'"],
      "script-src-attr": ["'none'"],
      "style-src": ["'self'", "https:", "'unsafe-inline'"],
      "upgrade-insecure-requests": [],
    };
  }

  /**
   * The headers last built, and the options object they were built from.
   *
   * Every response needs them and they only change with the options, which
   * the store replaces (never mutates) on an update: comparing identity is
   * enough to know when to rebuild.
   */
  protected cachedHeaders?: {
    options: HelmetOptions;
    sourcesVersion: number;
    headers: Record<string, string>;
  };

  /**
   * Sources other modules added to the policy, by kebab-case directive, in
   * the order they were added. See {@link addCspSource}.
   */
  protected readonly cspSources = new Map<string, string[]>();

  /**
   * Bumped on every new source, so the cached header string is rebuilt.
   */
  protected cspSourcesVersion = 0;

  /**
   * The inline scripts whose hash is in `script-src`, by exact content.
   */
  protected readonly hashedScripts = new Map<string, string>();

  protected buildHeaders(): Record<string, string> {
    const options = this.options;
    if (
      this.cachedHeaders?.options !== options ||
      this.cachedHeaders.sourcesVersion !== this.cspSourcesVersion
    ) {
      this.cachedHeaders = {
        options,
        sourcesVersion: this.cspSourcesVersion,
        headers: this.buildHeadersFromConfig(options),
      };
    }
    return this.cachedHeaders.headers;
  }

  /**
   * Whether a `Content-Security-Policy` goes out: helmet is on, the option is
   * set, and its `directives` (when given) are not the empty map that means
   * "no CSP".
   */
  public isCspEnabled(): boolean {
    const options = this.options;
    const csp = options.contentSecurityPolicy;
    if (options.disabled || !csp) {
      return false;
    }
    return !csp.directives || Object.keys(csp.directives).length > 0;
  }

  /**
   * Add sources to one directive of the policy, without restating it.
   *
   * Appended to the effective policy, the default one or the app's own
   * `directives`, and deduplicated. `directive` is kebab-case or camelCase
   * (`scriptSrc` and `script-src` are the same directive). A directive the
   * policy does not have is created from the value of `default-src` first,
   * so a `frame-src` added for one host keeps the `'self'` it inherited.
   *
   * Registered sources go out only when the CSP is on (see
   * {@link isCspEnabled}); registering while it is off is harmless. Call it
   * at `configure` time, never per request: the header is cached.
   *
   * @example
   * ```ts
   * alepha.inject(ServerHelmetProvider).addCspSource(
   *   "connect-src",
   *   "https://api.example.com",
   * );
   * ```
   */
  public addCspSource(directive: string, ...sources: string[]): void {
    const key = this.kebabDirective(directive);
    const list = this.cspSources.get(key) ?? [];
    let changed = false;
    for (const source of sources) {
      if (!list.includes(source)) {
        list.push(source);
        changed = true;
      }
    }
    if (changed) {
      this.cspSources.set(key, list);
      this.cspSourcesVersion++;
    }
  }

  /**
   * The CSP source for an inline script: `'sha256-<base64>'` of its exact
   * content, the bytes between `<script>` and `</script>`.
   */
  public cspScriptHash(content: string): string {
    const digest = createHash("sha256")
      .update(content, "utf8")
      .digest("base64");
    return `'sha256-${digest}'`;
  }

  /**
   * Allow one constant inline script by its hash: add the SHA-256 of
   * `content` to `script-src`, and return the source added.
   *
   * The content must be byte for byte what the document carries between
   * `<script>` and `</script>`. Computed once, when called: register at
   * `configure` time, never per request.
   */
  public addCspScriptHash(content: string): string {
    let source = this.hashedScripts.get(content);
    if (!source) {
      source = this.cspScriptHash(content);
      this.hashedScripts.set(content, source);
    }
    this.addCspSource("script-src", source);
    return source;
  }

  /**
   * Whether `content` is an inline script registered with
   * {@link addCspScriptHash}, so a document may carry it with no nonce.
   */
  public isCspScriptHashed(content: string): boolean {
    return this.hashedScripts.has(content);
  }

  /**
   * The sources registered with {@link addCspSource}, by kebab-case
   * directive. A copy.
   */
  public getCspSources(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [key, list] of this.cspSources) {
      out[key] = [...list];
    }
    return out;
  }

  protected kebabDirective(key: string): string {
    return key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  }

  /**
   * The effective directives: the app's (or the default), keys in kebab-case,
   * with every registered source appended.
   */
  protected effectiveCspDirectives(
    directives: CspDirectives,
  ): Map<string, CspDirective | boolean> {
    const map = new Map<string, CspDirective | boolean>();
    for (const [key, value] of Object.entries(directives)) {
      if (value === undefined) {
        continue;
      }
      const kebab = this.kebabDirective(key);
      // Two spellings of one directive (`scriptSrc` and `script-src`) are
      // merged: a browser reads only the first of two.
      const existing = map.get(kebab);
      if (existing !== undefined && typeof value !== "boolean") {
        map.set(kebab, this.mergeSources(existing, this.toList(value)));
        continue;
      }
      map.set(kebab, value);
    }
    if (map.size === 0) {
      return map;
    }
    for (const [key, sources] of this.cspSources) {
      const existing = map.get(key) ?? map.get("default-src") ?? [];
      map.set(key, this.mergeSources(existing, sources));
    }
    return map;
  }

  protected toList(value: CspDirective | boolean): string[] {
    if (Array.isArray(value)) {
      return value;
    }
    if (typeof value === "string") {
      return value.split(/\s+/).filter(Boolean);
    }
    return [];
  }

  protected mergeSources(
    existing: CspDirective | boolean,
    sources: string[],
  ): string[] {
    const list = [...this.toList(existing)];
    // `'none'` alone means nothing is allowed; with a source beside it, a
    // browser drops the whole directive's meaning. A registered source wins.
    const none = list.indexOf("'none'");
    if (none !== -1 && sources.length > 0) {
      list.splice(none, 1);
    }
    for (const source of sources) {
      if (!list.includes(source)) {
        list.push(source);
      }
    }
    return list;
  }

  /**
   * The headers this provider adds to a response, for a host that serves the
   * app's files without passing them through it.
   *
   * `alepha build` writes them into the `/*` rule of `dist/public/_headers`,
   * which Cloudflare's asset store and Bay apply to every file they answer
   * themselves. Empty when helmet is `disabled`.
   *
   * HSTS is always included when configured: the scheme check in
   * {@link onResponse} is a per-request decision a file cannot make, and a
   * browser ignores `Strict-Transport-Security` received over plain HTTP
   * anyway (RFC 6797, section 8.1).
   */
  public getHeaders(): Record<string, string> {
    if (this.options.disabled) {
      return {};
    }
    // A copy: the built headers are cached, and a caller may edit its own.
    return { ...this.buildHeaders() };
  }

  protected buildHeadersFromConfig(
    config: HelmetOptions,
  ): Record<string, string> {
    const headers: Record<string, string> = {};
    const {
      strictTransportSecurity: hsts,
      xContentTypeOptions,
      xFrameOptions,
      xXssProtection,
      contentSecurityPolicy: csp,
      referrerPolicy,
    } = config;

    // Strict-Transport-Security
    if (hsts) {
      let value = `max-age=${hsts.maxAge ?? 15552000}`;
      if (hsts.includeSubDomains) value += "; includeSubDomains";
      if (hsts.preload) value += "; preload";
      headers["strict-transport-security"] = value;
    }

    // X-Content-Type-Options
    if (xContentTypeOptions !== false) {
      headers["x-content-type-options"] = "nosniff";
    }

    // X-Frame-Options
    if (xFrameOptions) {
      headers["x-frame-options"] = xFrameOptions;
    }

    // X-XSS-Protection
    if (xXssProtection !== false) {
      headers["x-xss-protection"] = "1; mode=block";
    }

    // Referrer-Policy
    if (referrerPolicy) {
      headers["referrer-policy"] = referrerPolicy;
    }

    // Content-Security-Policy
    if (csp) {
      // `csp.directives`, not `Object.keys(csp)`: the option object always
      // carries that one key, so the old test was never true and the default
      // policy could not be reached by any configuration at all.
      const directives = this.effectiveCspDirectives(
        csp.directives ?? this.defaultCspDirectives(),
      );
      const value = [...directives]
        .map(([kebabKey, value]) => {
          if (Array.isArray(value)) {
            return `${kebabKey} ${value.join(" ")}`;
          }
          if (typeof value === "boolean" && value) {
            return kebabKey;
          }
          return `${kebabKey} ${value}`;
        })
        .join("; ");
      // An empty map means no header. Sending `content-security-policy:` with
      // nothing after it is not a permissive policy - it is a policy with no
      // directives, and browsers read the absent `default-src` as the
      // strictest possible answer, so an empty value could break a page
      // rather than leave it alone.
      if (value) {
        headers["content-security-policy"] = value;
      }
    }

    return headers;
  }

  protected readonly onResponse = $hook({
    on: "server:response:after",
    priority: "first",
    handler: ({ request, response }) => {
      // Read once: each access of a `$store` field is a store lookup.
      const options = this.options;
      if (options.disabled) {
        return;
      }

      // this check is important. Only add HSTS on HTTPS requests.
      //
      // Read from the REQUEST: `x-forwarded-proto` is what the proxy told us
      // about the inbound connection. Testing it on the response — which
      // never carries it — made the check collapse to `isProduction()`, so
      // HSTS went out over plain HTTP in production and never went out over
      // HTTPS anywhere else.
      const isSecure =
        request.headers["x-forwarded-proto"] === "https" ||
        request.protocol === "https" ||
        options.isSecure ||
        this.alepha.isProduction();

      const headersToSet = this.buildHeaders();

      for (const key in headersToSet) {
        if (key === "strict-transport-security" && !isSecure) {
          continue;
        }
        // don't overwrite headers if they are already set
        if (!response.headers[key]) {
          response.headers[key] = headersToSet[key];
        }
      }
    },
  });
}
