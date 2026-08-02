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
        directives: z.record(z.string(), z.any()),
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
    handler: ({ request, response }) => {
      if (this.options.disabled) {
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
