# useTheme

## Import

```typescript
import { useTheme } from "@alepha/ui/styles";
```

## Overview

Hook to get and set the current theme.

Returns a tuple with the current theme, a function to set the theme,
and expert mode controls for fine-grained customization.

```tsx
const [theme, setTheme, expert] = useTheme();
```

