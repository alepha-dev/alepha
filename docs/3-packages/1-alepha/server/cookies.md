# Alepha - Server Cookies

## Installation

Part of the `alepha` package. Import from `alepha/server/cookies`.

```bash
npm install alepha
```

## Overview

| type | quality | stability |
|------|---------|-----------|
| backend | standard | stable |

Server and browser-safe cookie handling.

**Features:**
- Cookie management on server and browser

## API Reference

### Primitives

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $cookie()

Creates a browser-side cookie primitive for client-side cookie management.

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
This primitive provides methods to get, set, and delete the cookie
within the server request/response cycle.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `APP_SECRET` | text | DEFAULT_APP_SECRET |  |
