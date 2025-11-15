# Alepha Server Cookies

Type-safe HTTP cookie parsing and serialization for servers.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Provides HTTP cookie management capabilities for server requests and responses with type-safe cookie descriptors.

The server-cookies module enables declarative cookie handling using the `$cookie` descriptor on class properties.
It offers automatic cookie parsing, secure cookie configuration, and seamless integration with server routes
for managing user sessions, preferences, and authentication tokens.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaServerCookies } from "alepha/server/cookies";

const alepha = Alepha.create()
	.with(AlephaServerCookies);

run(alepha);
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

#### $cookie()

Creates a browser-side cookie descriptor for client-side cookie management.

Browser-specific version of $cookie that uses document.cookie API. Supports type-safe
cookie operations with schema validation but excludes encryption/signing (use server-side
$cookie for secure operations).

**Note**: This is the browser version - encryption, signing, and compression are not supported.

```ts
class ClientCookies {
  preferences = $cookie({
    name: "user-prefs",
    schema: t.object({ theme: t.text(), language: t.text() }),
    ttl: [30, "days"]
  });

  savePreferences() {
    this.preferences.set({ theme: "dark", language: "en" });
  }

  getPreferences() {
    return this.preferences.get() ?? { theme: "light", language: "en" };
  }
}
```

#### $cookie()

Declares a type-safe, configurable HTTP cookie.
This descriptor provides methods to get, set, and delete the cookie
within the server request/response cycle.
