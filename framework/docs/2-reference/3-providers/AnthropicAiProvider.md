# AnthropicAiProvider

## Import

```typescript
import { AnthropicAiProvider } from "alepha/ai/anthropic";
```

## Overview

AI provider for the Anthropic Messages API, over plain `fetch`.

- Streams with server-sent events and maps them to `AiEvent`s: text
  deltas as they arrive, a tool call once its input JSON is complete.
- Marks the system prompt and the tool list for prompt caching. Both stay
  byte-identical across the turns of a conversation (per-turn page data
  rides on the user message), so every turn after the first reads them
  from the cache.
- Keeps the model's thinking blocks on the assistant message (`vendor`)
  and sends them back, as the API requires for a turn that called tools.
- Maps failures to typed `AiError`s: `AiAuthError` (401, 403),
  `AiRateLimitError` (429, with `retryAfter`), `AiOverloadedError` (529),
  `AiContextLengthError` (a prompt too long).

**Environment:** `AI_API_KEY` and `AI_MODEL` are required, checked at
start. `AI_BASE_URL` replaces `https://api.anthropic.com`, for Cloudflare
AI Gateway (`https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic`).
