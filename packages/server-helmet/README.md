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

#### ServerHelmetProvider

Provides a configurable way to apply essential HTTP security headers
to every server response, without external dependencies.
