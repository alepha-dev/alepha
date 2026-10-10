# ContentInspector

## Import

```typescript
import { ContentInspector } from "@alepha/capacitor/core";
```

## Overview

Answers which web layer is running, for `WebContentProvider`.

The base answer is the build's own: `bundled` or `dev`, from the public
configuration, never from the URL (a bundled shell and a dev server can
share a pathname). A live updater adds a source (`addSource`) that
answers `ota` and the bundle's version when one runs, so core never
imports an updater and runs without one. A source rather than a
substitution: the updater's module registers after this one has served.
