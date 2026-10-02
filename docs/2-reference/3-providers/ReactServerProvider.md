# ReactServerProvider

## Import

```typescript
import { ReactServerProvider } from "alepha/react/router";
```

## Overview

React server provider responsible for SSR and static file serving.

Coordinates between:

- ReactPageProvider: Page routing and layer resolution
- ReactServerTemplateProvider: HTML template parsing and streaming
- ServerHeadProvider: Head content management
- SSRManifestProvider: Module preload link collection

Uses `react-dom/server` under the hood.
