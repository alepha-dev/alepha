# ViteDevServerProvider

## Import

```typescript
import { ViteDevServerProvider } from "alepha/cli";
```

## Overview

Vite development server with Alepha integration.

Architecture:
- Vite owns the HTTP server
- Alepha handles requests via Vite plugin middleware
- Request flow: Vite built-in (HMR, assets) → Alepha routes

HMR Strategy:
- Browser-only changes (CSS, client components) → Vite HMR (React Fast Refresh)
- Server-only changes → Reload Alepha → Full browser reload
- Shared changes → Reload Alepha → Let HMR propagate

