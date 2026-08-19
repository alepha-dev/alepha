# ReactServerErrorProvider

## Import

```typescript
import { ReactServerErrorProvider } from "alepha/react/router";
```

## Overview

Answers a browser navigation with an HTML error page instead of JSON.

`ServerRouterProvider` serializes every error as JSON, which is the right
answer for an API and the wrong one for a hard navigation: the visitor gets
`{"status":503,…}` painted as text on a white background, with no styles, no
favicon and no way back.

The router already renders a real error page for anything a *loader* or a
*component* throws — that path runs inside `createLayers`, which owns
`errorHandler`. What never reached it is everything thrown *around* the
render: `use:` middleware, and every `server:onRequest` hook. Those are not
exotic. `ServerNotReadyProvider` throws 503 while the app is still booting,
`ServerRateLimitProvider` throws 429, `ServerAuthProvider` throws 401 on a
stale token. All three land on a first-time visitor, and all three used to
answer with JSON.

This provider closes that gap from the react side, on the hook the server
already offers for it: `errorHandler` emits `server:onError` first and stops
as soon as a listener has set a status. So `alepha/server` needs no change,
and an app that does not load the react router keeps the JSON behaviour
exactly as it is.

Two conditions, both required:

- **`Accept: text/html`.** A browser navigation asks for HTML; `fetch`,
  `$action` sub-requests, curl and health checks send a wildcard or
  `application/json` and keep getting JSON. A bare wildcard never counts —
  that is what every programmatic client sends.
- **React is loaded.** Guaranteed by construction: this provider ships with
  `alepha/react/router`, so an API-only app has no such listener.

