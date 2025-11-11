# Alepha Server Basic Auth

HTTP Basic Authentication middleware for server routes.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Provides HTTP Basic Authentication for server routes with configurable credentials.

The server-basic-auth module enables HTTP Basic Authentication using the `basicAuth` option
in action descriptors or through the `$basicAuth` descriptor for global path-based protection.

Features:
- Per-route authentication via action options
- Global authentication with path filtering
- Multiple auth instances support
- Standard HTTP Basic Authentication (RFC 7617)

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaServerBasicAuth } from "alepha/server/basic-auth";

const alepha = Alepha.create()
	.with(AlephaServerBasicAuth);

run(alepha);
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

#### $basicAuth()

Declares HTTP Basic Authentication for server routes.
This descriptor provides methods to protect routes with username/password authentication.
