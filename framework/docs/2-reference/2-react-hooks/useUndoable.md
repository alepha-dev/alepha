# useUndoable

## Import

```typescript
import { useUndoable } from "@alepha/ui";
```

## Overview

Optimistic writes with an Undo toast.

`run` applies the local change at once, shows a toast with an Undo button,
and either commits now (`undo` given) or when the window closes. It
resolves once the change is visible and, in immediate mode, accepted.

Call it straight from the click, not from inside a `useAction`: the
change must reach the screen in the click's own frame, and `useAction`
awaits its `react:action:begin` listeners before the handler starts. `run`
reports its own failures (rolled back, then `react:action:error`, which
the root `ActionErrorToaster` shows). `Ctrl+Z` / `Cmd+Z` undoes the newest
open toast.
