# ReactPageCacheProvider

## Import

```typescript
import { ReactPageCacheProvider } from "alepha/react/router";
```

## Overview

The automatic page cache.

Every server-rendered page whose render read nothing personal (see
`ReadRecorder`) is cached, with no option: its shared bytes, everything but
the private hydration script, are kept under
`page:<build>:<name>:<params>:<query>:<lang>:<origin>`. A later request for
the same key, signed in or not, gets those bytes followed by a private
script built for it, without running a loader or React.

A page may write the request's origin into its markup, and that origin is
the `Host` header, which the visitor chooses. With `PUBLIC_URL` set, the
origin of every key is `PUBLIC_URL`'s, and a request for another host is
rendered without reading or writing the cache. Without it, the origin is
the request's own (see `requestOrigin`): one host is never answered
with bytes rendered for another, and each host a visitor makes up gets an
entry of its own.

- Lifetime: a page with no loader anywhere in its layer chain lives until
  the next deploy (the build is in the key); a page with a loader, 60 s.
  `$page({ cache: { ttl } })` overrides, `$page({ cache: false })` opts out.
- Storage: the app's `CacheProvider`, so with Redis an entry and its
  invalidation span instances. The in-memory provider is replaced by a
  bounded LRU here (it has no size limit of its own), and so is the workerd
  default, whose edge tier is `caches.default`, not KV.
- Kill switch: `REACT_PAGE_CACHE=false`, or the `enabled` option.
