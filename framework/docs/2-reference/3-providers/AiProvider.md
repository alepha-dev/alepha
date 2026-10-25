# AiProvider

## Import

```typescript
import { AiProvider } from "alepha/ai";
```

## Overview

The contract every AI vendor implements: one streamed chat call.

Which vendor answers is decided by the module the app registers, never by
an env string: `AlephaAi` installs `MemoryAiProvider` as the default,
and a vendor module (`alepha/ai/anthropic`, `alepha/ai/openai`,
`alepha/ai/cloudflare`) substitutes itself for this class.

A provider is stateless between calls: the whole conversation travels in
every `AiChatRequest`.
