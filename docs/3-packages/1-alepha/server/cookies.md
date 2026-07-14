# Alepha - Server Cookies

## Installation

Part of the `alepha` package. Import from `alepha/server/cookies`.

```bash
npm install alepha
```

## Overview

Server and browser-safe cookie handling.

**Features:**
- Cookie management on server and browser

## API Reference

### Primitives

- [`$cookie`](/docs/reference-primitives-$cookie) — Declares a type-safe, configurable HTTP cookie.

### Providers

- [`AtomCookiePersistence`](/docs/reference-providers-atomcookiepersistence) — Binds every atom declared with `persist: "cookie"` to an HTTP cookie.
