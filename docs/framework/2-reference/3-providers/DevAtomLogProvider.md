# DevAtomLogProvider

## Import

```typescript
import { DevAtomLogProvider } from "alepha";
```

## Overview

In-memory ring buffer of `state:mutate` events, powering the devtools
"Recent mutations" panel. Dev-only, capped at 200 entries.

`serverOnly` atoms are never buffered: `serverOnly` is documented as a
security guard (its value must never reach a browser), and this buffer
backs the `GET /__devtools/api/atoms/log` route, served straight to the
devtools UI. A mutation on a raw state key with no registered atom
(`StateManager.getAtom()` returns `undefined`) is still logged as before -
only known `serverOnly` atoms are skipped.
