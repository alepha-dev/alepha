# WorkerdFileSystemProvider

## Import

```typescript
import { WorkerdFileSystemProvider } from "alepha/system";
```

## Overview

Web-standard implementation of FileSystemProvider for Cloudflare Workers and other edge runtimes.

Uses only Web APIs (ReadableStream, TextEncoder, etc.) - no Node.js-specific APIs.
Provides working `createFile` with proper streaming support.
Filesystem operations (rm, cp, stat, etc.) are not available in edge runtimes and will throw.

