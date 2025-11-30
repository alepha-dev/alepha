# Alepha - Server Basic Auth

## Installation

```bash
npm install alepha
```

## Overview

Provides HTTP Basic Authentication for server routes with configurable credentials.

The server-basic-auth module enables HTTP Basic Authentication using the `basicAuth` option
in action primitives or through the `$basicAuth` primitive for global path-based protection.

Features:
- Per-route authentication via action options
- Global authentication with path filtering
- Multiple auth instances support
- Standard HTTP Basic Authentication (RFC 7617)

## API Reference

### Primitives

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/primitives).

#### $basicAuth()

Declares HTTP Basic Authentication for server routes.
This primitive provides methods to protect routes with username/password authentication.
