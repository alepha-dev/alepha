# useSidebarState

## Import

```typescript
import { useSidebarState } from "alepha/react/ui";
```

## Overview

Read and update the sidebar collapsed state. The value is persisted via the
`alepha-ui` cookie so it survives reloads and is available during SSR - no
flash of expanded-then-collapsed when the user prefers a collapsed shell.

## Examples

const { collapsed, setCollapsed, toggle } = useSidebarState();

