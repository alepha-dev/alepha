# useTheme

## Import

```typescript
import { useTheme } from "alepha/react/ui";
```

## Overview

Read and update the active theme palette name. UI consumers typically map
the value to a class on the document root (e.g. `theme-claude`).

## Examples

const { theme, setTheme } = useTheme();
setTheme("claude");
