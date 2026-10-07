# WebContentProvider

## Import

```typescript
import { WebContentProvider } from "@alepha/capacitor/core";
```

## Overview

Read-only: where the running web layer came from.

`undefined` in a plain website. In a shell, the mode comes from the
`ContentInspector` (the build's own answer, or an updater's) and the
origin from the page.
