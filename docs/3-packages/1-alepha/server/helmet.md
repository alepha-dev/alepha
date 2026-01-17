# Alepha - Server Helmet

## Installation

Part of the `alepha` package. Import from `alepha/server/helmet`.

```bash
npm install alepha
```

## Overview

Automatically adds important HTTP security headers to every response
to help protect your application from common web vulnerabilities.

## API Reference

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/concepts-providers).

#### ServerHelmetProvider

Provides a configurable way to apply essential HTTP security headers
to every server response, without external dependencies.
