# useColorMode

## Import

```typescript
import { useColorMode } from "alepha/react/ui";
```

## Overview

Read and update the user's color-mode preference. `"system"` resolves to
the OS preference and updates live as the OS toggles between light/dark.

## Examples

const { mode, setMode, resolved } = useColorMode();
setMode("dark");
document.documentElement.classList.toggle("dark", resolved === "dark");
