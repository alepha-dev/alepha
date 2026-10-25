# StatusBarProvider

## Import

```typescript
import { StatusBarProvider } from "@alepha/capacitor/core";
```

## Overview

The system bars of a native shell, over `SystemBars` from `@capacitor/core`
(built in since Capacitor 8, edge to edge, and the source of the
`--safe-area-inset-*` CSS variables). A no-op on the web.

`style` follows Capacitor's naming: `dark` is light content for a dark
background, `light` dark content for a light one, `default` follows the
system.
