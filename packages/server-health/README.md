# Alepha Server Health

Adds a /health endpoint for monitoring application status.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Plugin for Alepha Server that provides health-check endpoints.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaServerHealth } from "alepha/server/health";

const alepha = Alepha.create()
	.with(AlephaServerHealth);

run(alepha);
```

## API Reference

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/providers).

#### ServerHealthProvider

Register `/health` endpoint.

- Provides basic health information about the server.
