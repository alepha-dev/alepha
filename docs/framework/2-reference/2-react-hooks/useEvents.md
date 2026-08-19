# useEvents

## Import

```typescript
import { useEvents } from "alepha/react";
```

## Overview

Allow subscribing to multiple Alepha events. See `Hooks` for available events.

useEvents is fully typed to ensure correct event callback signatures.

## Examples

```tsx
useEvents(
  {
    "react:transition:begin": (ev) => {
      console.log("Transition began to:", ev.state.pathname);
    },
    "react:transition:error": {
      priority: "first",
      callback: (ev) => {
        console.error("Transition error:", ev.error);
      },
    },
  },
  [],
);
```

