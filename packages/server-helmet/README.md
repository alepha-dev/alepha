# Alepha Server Helmet

Essential, configurable security headers for all server responses.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Automatically adds important HTTP security headers to every response
to help protect your application from common web vulnerabilities.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaServerHelmet } from "alepha/server/helmet";

const alepha = Alepha.create()
	.with(AlephaServerHelmet);

run(alepha);
```

## API Reference

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/providers).

#### ServerHelmetProvider

Helmet security headers configuration atom
/
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

declare module "@alepha/core" {
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
Provides a configurable way to apply essential HTTP security headers
to every server response, without external dependencies.
