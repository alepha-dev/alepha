# useOverlay

## Import

```typescript
import { useOverlay } from "alepha/react/router";
```

## Overview

The overlay on screen, and the way out of it.

`close` goes back through history, so Forward reopens the overlay and the
page behind it is neither remounted nor scrolled.

## Examples

```tsx
const { close } = useOverlay();
return <Sheet open onOpenChange={(open) => !open && close()} />;
```
