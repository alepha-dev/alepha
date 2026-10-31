# $cookie

## Import

```typescript
import { $cookie } from "alepha/server/cookies";
```

## Overview

Declares a type-safe, configurable HTTP cookie.
This primitive provides methods to get, set, and delete the cookie
within the server request/response cycle.

A browser silently drops a cookie past 4 KB, so a server cookie is chunked
automatically: a value that encodes to more than 3,800 bytes is written as
`<name>.0`, `<name>.1`, ... and joined back on read, with stale chunks expired
on every set and delete. A name ending in `.<number>` is therefore reserved. A
`prefix: false` cookie is read by the browser, so it is never chunked: writing
one over that size throws.

Chunking does not lift the limits on request headers, and every chunk goes back
on every request. Node caps all of a request's headers at 16 KB and a default
nginx its `Cookie` header at 8 KB, past which a request fails with 431 or 400.
The server logs a warning when a client's cookies pass about 6 KB. A very large
value, such as a big token set, belongs in a server-side session with only an
ID in the cookie.

## Options

| Option     | Type                          | Required | Description                                                                                                                                                     |
| ---------- | ----------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema`   | `T`                           | Yes      | The schema for the cookie's value, used for validation and type safety.                                                                                         |
| `name`     | `string`                      | No       | The name of the cookie.                                                                                                                                         |
| `path`     | `string`                      | No       | The cookie's path                                                                                                                                               |
| `ttl`      | `DurationLike`                | No       | Time-to-live for the cookie                                                                                                                                     |
| `secure`   | `boolean`                     | No       | If true, the cookie is only sent over HTTPS                                                                                                                     |
| `httpOnly` | `boolean`                     | No       | If true, the cookie cannot be accessed by client-side scripts.                                                                                                  |
| `sameSite` | `"strict" \| "lax" \| "none"` | No       | SameSite policy for the cookie                                                                                                                                  |
| `domain`   | `string`                      | No       | The domain for the cookie.                                                                                                                                      |
| `compress` | `boolean`                     | No       | If true, the cookie value will be compressed using zlib.                                                                                                        |
| `encrypt`  | `boolean`                     | No       | If true, the cookie value will be encrypted                                                                                                                     |
| `sign`     | `boolean`                     | No       | If true, the cookie will be signed to prevent tampering                                                                                                         |
| `key`      | `string`                      | No       | Optional key to link this cookie to an Atom, enabling automatic synchronization between the cookie and the Atom's state.                                        |
| `prefix`   | `boolean`                     | No       | Internal escape hatch: when explicitly set to `false`, the server skips the `alepha.name` cookie-name namespace applied by `ServerCookiesProvider.prefixName()` |
