# ContentInspector

## Import

```typescript
import { ContentInspector } from "@alepha/capacitor/core";
```

## Overview

Answers which web layer is running, for `WebContentProvider`.

The base answer is the build's own: `bundled` or `dev`, from the public
configuration, never from the URL (a bundled shell and a dev server can
share a pathname). A live updater substitutes this class to add `ota` and
the bundle's version, so core never imports an updater and runs without
one.
