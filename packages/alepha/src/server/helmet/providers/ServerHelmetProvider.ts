import { $atom, $hook, $inject, $use, Alepha, type Static, t } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Helmet security headers configuration atom
 */
export const helmetOptions = $atom({
  name: "alepha.server.helmet.options",
  schema: t.object({
    isSecure: t.optional(t.boolean()),
    strictTransportSecurity: t.optional(
      t.object({
        maxAge: t.optional(t.number()),
        includeSubDomains: t.optional(t.boolean()),
        preload: t.optional(t.boolean()),
      }),
    ),
    xContentTypeOptions: t.optional(t.boolean()),
    xFrameOptions: t.optional(t.enum(["DENY", "SAMEORIGIN"])),
    xXssProtection: t.optional(t.boolean()),
    contentSecurityPolicy: t.optional(
      t.object({
        directives: t.record(t.string(), t.any()),
      }),
    ),
    referrerPolicy: t.optional(
      t.enum([
        "no-referrer",
        "no-referrer-when-downgrade",
        "origin",
        "origin-when-cross-origin",
        "same-origin",
        "strict-origin",
        "strict-origin-when-cross-origin",
        "unsafe-url",
      ]),
    ),
  }),
  default: {
    strictTransportSecurity: { maxAge: 15552000, includeSubDomains: true },
    xFrameOptions: "SAMEORIGIN",
    xXssProtection: false,
    referrerPolicy: "strict-origin-when-cross-origin",
  },
});

export type HelmetOptions = Static<typeof helmetOptions.schema>;

declare module "alepha" {
  interface State {
    [helmetOptions.key]: HelmetOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

type CspDirective = string | string[];

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
  directives: CspDirectives;
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
  protected readonly alepha = $inject(Alepha);

  /**
   * The configuration options loaded from the atom.
   */
  protected readonly options = $use(helmetOptions);

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
   * Build security headers with optional per-route overrides.
   * Used by the `$helmet` middleware.
   */
  public buildHeadersFor(
    overrides?: Partial<HelmetOptions>,
  ): Record<string, string> {
    if (!overrides) return this.buildHeadersFromConfig(this.options);
    const merged = { ...this.options, ...overrides };
    return this.buildHeadersFromConfig(merged);
  }

  protected buildHeaders(): Record<string, string> {
    return this.buildHeadersFromConfig(this.options);
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
      const directives =
        Object.keys(csp).length === 0
          ? this.defaultCspDirectives()
          : csp.directives;
      headers["content-security-policy"] = Object.entries(directives)
        .map(([key, value]) => {
          const kebabKey = key.replace(
            /[A-Z]/g,
            (letter) => `-${letter.toLowerCase()}`,
          );
          if (Array.isArray(value)) {
            return `${kebabKey} ${value.join(" ")}`;
          }
          if (typeof value === "boolean" && value) {
            return kebabKey;
          }
          return `${kebabKey} ${value}`;
        })
        .join("; ");
    }

    return headers;
  }

  protected readonly onResponse = $hook({
    on: "server:onResponse",
    priority: "first",
    handler: ({ response }) => {
      // this check is important. Only add HSTS on HTTPS requests.
      const isSecure =
        response.headers["x-forwarded-proto"] === "https" ||
        this.options.isSecure ||
        this.alepha.isProduction();

      const headersToSet = this.buildHeaders();

      for (const [key, value] of Object.entries(headersToSet)) {
        if (key === "strict-transport-security" && !isSecure) {
          continue;
        }
        // don't overwrite headers if they are already set
        if (!response.headers[key]) {
          response.headers[key] = value;
        }
      }
    },
  });
}
