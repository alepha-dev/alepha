# Alepha Server Cookies

Type-safe HTTP cookie parsing and serialization for servers.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/server-cookies
```

## API Reference

### Descriptors

#### $cookie()

Declares a type-safe, configurable HTTP cookie.
This descriptor provides methods to get, set, and delete the cookie
within the server request/response cycle.
