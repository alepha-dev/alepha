# Alepha - Server Health

## Installation

Part of the `alepha` package. Import from `alepha/server/health`.

```bash
npm install alepha
```

## Overview

Plugin for Alepha Server that provides health-check endpoints.

## API Reference

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/concepts-providers).

#### ServerHealthProvider

Register `/health` & `/healthz` endpoint.

- Provides basic health information about the server.
