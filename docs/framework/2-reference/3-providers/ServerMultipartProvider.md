# ServerMultipartProvider

## Import

```typescript
import { ServerMultipartProvider } from "alepha/server";
```

## Overview

Parses `multipart/form-data` request bodies into route handler input.

**Each `z.file()` field is still materialised** — a `FileLike` promises to be
readable more than once, and honouring that means keeping the bytes. What
changed is that the ceiling is now decided per request instead of once for
the whole application, and that it is enforced by counting bytes as they
arrive rather than by trusting `Content-Length` and then buffering anyway.

The budget is resolved at three levels, most specific last:

1. `multipartOptions` — the application-wide default.
2. `z.file({ maxBytes })` on the route's own body schema.
3. `MultipartCapProvider` — the only level that knows where the bytes
   are actually going, which is why it wins.

A level can *raise* the ceiling, not merely lower it. That inversion was the
whole problem before: a bucket declaring `maxSize: 100` was silently capped
by a 5 MB global it knew nothing about, so the declaration read like a
promise the framework could not keep.

⚠️ Raising a ceiling on this path is not free. `$secure` runs *after* this
hook, so whatever budget is granted here is reachable before authentication —
a bigger number is a cheaper denial of service until the bytes stop being
buffered.

plus a delimiter regardless of payload size.

