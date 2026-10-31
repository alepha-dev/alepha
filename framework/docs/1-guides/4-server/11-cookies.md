# Cookies

`$cookie` declares an HTTP cookie with a schema. You read, write and delete it
from a handler, and it can be signed, encrypted or compressed on the way.

```typescript check
import { $cookie } from "alepha/server/cookies";
```

## Declaring a cookie

```typescript check
import { z } from "alepha";
import { $action } from "alepha/server";
import { $cookie } from "alepha/server/cookies";

class Preferences {
  theme = $cookie({
    name: "theme",
    schema: z.enum(["light", "dark"]),
    ttl: [1, "year"],
  });

  setTheme = $action({
    method: "POST",
    path: "/preferences/theme",
    schema: {
      body: z.object({ theme: z.enum(["light", "dark"]) }),
    },
    handler: async ({ body }) => {
      this.theme.set(body.theme);
    },
  });

  getTheme = $action({
    method: "GET",
    path: "/preferences/theme",
    schema: {
      response: z.object({ theme: z.enum(["light", "dark"]) }),
    },
    handler: async () => ({ theme: this.theme.get() ?? "light" }),
  });
}
```

| Method        | What it does                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `.get()`      | The decoded value, or `undefined` when the cookie is absent or invalid.                                                         |
| `.set(value)` | Validates the value against the schema and adds a `Set-Cookie` to the response. `ttl` overrides the declared one for this call. |
| `.del()`      | Deletes the cookie, with the path and domain it was declared with.                                                              |

All three work during a request. Outside one they throw, unless you hand them a
cookie jar with `{ cookies }`.

## Options

| Option     | Default                | What it does                                                                                                    |
| ---------- | ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `schema`   |                        | Validates the value, and types it.                                                                              |
| `name`     | the property key       | The cookie's name, before the prefix below.                                                                     |
| `path`     | `/`                    | The path it applies to.                                                                                         |
| `domain`   |                        | The domain it applies to.                                                                                       |
| `ttl`      | none: a session cookie | Maps to `Max-Age`.                                                                                              |
| `secure`   | `true` in production   | Adds `Secure`, on a request whose URL is `https`. Behind a proxy that means it sent `x-forwarded-proto: https`. |
| `httpOnly` | not set                | Hide it from client-side scripts.                                                                               |
| `sameSite` | `lax`                  | `strict`, `lax` or `none`.                                                                                      |
| `sign`     | `false`                | Refuse a value that was tampered with.                                                                          |
| `encrypt`  | `false`                | Hide the value from the browser.                                                                                |
| `compress` | `false`                | Deflate the value.                                                                                              |
| `key`      |                        | Keep the cookie and the atom of that key in step.                                                               |

⚠️ **`httpOnly` is off unless you set it.** A cookie holding anything sensitive
should say `httpOnly: true`.

`lax` is the default rather than `strict` because a strict cookie is not sent on
the top-level redirect that brings a user back from an OAuth provider.

## The name on the wire

A `$cookie` is prefixed with the app's name, lowercased: `theme` in an app named
`shop` is sent as `shop.theme`. Cookies are scoped by host and path and not
by port, so without the prefix two apps on `localhost` would overwrite each other's.

The app's name is `APP_NAME`, else the build's app name, else `app`. Changing it
renames every cookie, so existing ones stop being read.

## Signing and encrypting

```typescript check
import { z } from "alepha";
import { $cookie } from "alepha/server/cookies";

class Session {
  session = $cookie({
    name: "session",
    schema: z.object({ userId: z.uuid() }),
    ttl: [30, "days"],
    httpOnly: true,
    encrypt: true,
    sign: true,
  });
}
```

Both derive their key from `APP_SECRET`, so changing the secret invalidates these
cookies.

| Option     | Algorithm   | A bad value                                                              |
| ---------- | ----------- | ------------------------------------------------------------------------ |
| `sign`     | HMAC-SHA256 | `.get()` answers `undefined`, logs a warning, and the cookie is deleted. |
| `encrypt`  | AES-256-GCM | `.get()` answers `undefined`, and the cookie is deleted.                 |
| `compress` | raw deflate | `.get()` answers `undefined`, and the cookie is deleted.                 |

A value that fails its schema, or is not valid JSON, is treated as corrupted too:
`.get()` answers `undefined` and the cookie is deleted. The deletion carries the
cookie's own `path` and `domain`.

## Large values

A browser silently drops a cookie past about 4 KB, so a `$cookie` is chunked for
you: a value that encodes to more than 3,800 bytes is written as `<name>.0`,
`<name>.1`, ... with the same attributes, and joined back on read. `.set()` and
`.del()` expire the chunks the cookie no longer uses, and a lost or altered chunk
counts as a bad value, as above. A name ending in `.<number>` is therefore reserved.

A cookie the browser reads cannot be chunked. An atom with `persist: "cookie"` is
not written past that size, and the server logs a warning.

Chunking keeps the value, not the cost: every chunk goes back on every request, and
request headers are capped, at 16 KB in total by default on Node and 8 KB for the
`Cookie` header on a default nginx. Past that a request fails with a 431 or a 400,
before any of your code runs. The server logs a warning naming the cookie and its
size once a client's cookies pass about 6 KB. A very large value belongs in a
server-side session, with only an ID in the cookie, see
[Authentication](/docs/guides-security-authentication).

## In the browser

`$cookie` also works in browser code, on `document.cookie`, with three differences:

- Signing, encrypting and compressing are server-only: `.get()` and `.set()` throw
  on a cookie declared with one of them.
- `.get()` throws on a value it cannot read, rather than answering `undefined`.
- `.set()` takes no `ttl` override, and never adds `Secure`.

⚠️ The browser reads the bare name and the server reads the prefixed one, so a
plain `$cookie` is not shared between the two. For a value both sides read, use an
atom with `persist: "cookie"`, whose cookie has no prefix, see
[State management](/docs/guides-frontend-state-management). Such an atom is
unsigned, and `$cookie` is the one to use for anything a user must not forge.

## Cookies and the page cache

Reading or setting a cookie during a page render makes that page personal, so it
is never cached. See [Page cache](/docs/guides-frontend-page-cache).
