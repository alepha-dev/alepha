# ReactServerTemplateProvider

## Import

```typescript
import { ReactServerTemplateProvider } from "alepha/react/router";
```

## Overview

Handles HTML streaming for SSR.

Uses hardcoded HTML structure - all customization via $head primitive.
Pre-encodes static parts as Uint8Array for zero-copy streaming.

