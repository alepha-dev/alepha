# WorkersAiProvider

## Import

```typescript
import { WorkersAiProvider } from "alepha/ai/cloudflare";
```

## Overview

AI provider on the Workers AI binding (`env.AI.run`): no API key, no
HTTP, the model runs where the Worker runs.

- Streams with `stream: true`, read by `ChatCompletionFormat`: current
  models stream Chat Completions chunks, older ones `{ response }`.
- Function calling on the models whose catalog entry says
  `function_calling`. Offering tools to any other model throws
  `AiToolsUnsupportedError`, so the app knows to pick another model or
  register `AlephaAiAnthropic` instead. The catalog is read once per model,
  through the binding's own `models()`.
- The binding is checked at start: a missing one fails with a named
  `AiConfigError`, as the R2 provider does. This provider only exists on
  Workers (see `AlephaAiCloudflare`).

**Environment:** `AI_MODEL` (a Workers AI id such as
`@cf/meta/llama-4-scout-17b-16e-instruct`), `AI_BINDING` (default `AI`),
`AI_GATEWAY_ID` (optional).
