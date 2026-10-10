# WindowProvider

## Import

```typescript
import { WindowProvider } from "@alepha/desktop/shell";
```

## Overview

The native window of a desktop app, behind which the webview binding and
the macOS menu live.

⚠️ `run` blocks the thread it is called on until the window closes or
the loop is terminated from another thread with the `handle`: nothing
queued on that thread's event loop runs meanwhile. The shell supervises the
server Worker from a Worker of its own for that reason.
