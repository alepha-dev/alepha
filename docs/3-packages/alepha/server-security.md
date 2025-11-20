# Alepha - Server Security

## Installation

```bash
npm install alepha
```

## Overview

Plugin for Alepha Server that provides security features. Based on the Alepha Security module.

By default, all $action will be guarded by a permission check.

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

#### $basicAuth()

Declares HTTP Basic Authentication for server routes.
This descriptor provides methods to protect routes with username/password authentication.
