# Alepha - Server Security

## Installation

Part of the `alepha` package. Import from `alepha/server/security`.

```bash
npm install alepha
```

## Overview

Plugin for Alepha Server that provides security features. Based on the Alepha Security module.

By default, all $action will be guarded by a permission check.

## API Reference

### Primitives

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $basicAuth()

Declares HTTP Basic Authentication for server routes.
This primitive provides methods to protect routes with username/password authentication.
