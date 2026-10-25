# NativeDeepLinkProvider

## Import

```typescript
import { NativeDeepLinkProvider } from "@alepha/capacitor/core";
```

## Overview

Deep links from `@capacitor/app`: the launch URL and `appUrlOpen`.

The listener is added on `start`, before the launch URL is read on
`ready`, so a link that arrives in between is not lost; one that arrives
twice is handled once.
