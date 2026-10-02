# $cookie

## Import

```typescript
import { $cookie } from "alepha/server/cookies";
```

## Overview

Declares a type-safe, configurable HTTP cookie.
This primitive provides methods to get, set, and delete the cookie
within the server request/response cycle.

## Options

| Option     | Type                          | Required | Description                                                                                                                                                  |
| ---------- | ----------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `schema`   | `T`                           | Yes      | The schema for the cookie's value, used for validation and type safety.                                                                                      |
| `name`     | `string`                      | No       | The name of the cookie.                                                                                                                                      |
| `path`     | `string`                      | No       | The cookie's path                                                                                                                                            |
| `ttl`      | `DurationLike`                | No       | Time-to-live for the cookie                                                                                                                                  |
| `secure`   | `boolean`                     | No       | If true, the cookie is only sent over HTTPS                                                                                                                  |
| `httpOnly` | `boolean`                     | No       | If true, the cookie cannot be accessed by client-side scripts.                                                                                               |
| `sameSite` | `"strict" \| "lax" \| "none"` | No       | SameSite policy for the cookie                                                                                                                               |
| `domain`   | `string`                      | No       | The domain for the cookie.                                                                                                                                   |
| `compress` | `boolean`                     | No       | If true, the cookie value will be compressed using zlib.                                                                                                     |
| `encrypt`  | `boolean`                     | No       | If true, the cookie value will be encrypted                                                                                                                  |
| `sign`     | `boolean`                     | No       | If true, the cookie will be signed to prevent tampering                                                                                                      |
| `key`      | `string`                      | No       | Optional key to link this cookie to an Atom, enabling automatic synchronization between the cookie and the Atom's state.                                     |
| `prefix`   | `boolean`                     | No       | Internal escape hatch: when explicitly set to `false`, the server skips the `APP_NAME` cookie-name namespace applied by `ServerCookiesProvider.prefixName()` |
