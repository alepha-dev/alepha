# OpenAiCompatibleAiProvider

## Import

```typescript
import { OpenAiCompatibleAiProvider } from "alepha/ai/openai";
```

## Overview

AI provider for the OpenAI Chat Completions wire format, over plain
`fetch`. One provider for every compatible endpoint, picked by
`AI_BASE_URL`:

| endpoint             | `AI_BASE_URL`                                                   |
| -------------------- | --------------------------------------------------------------- |
| OpenAI (default)     | `https://api.openai.com/v1`                                     |
| Workers AI over REST | `https://api.cloudflare.com/client/v4/accounts/<account>/ai/v1` |
| OpenRouter           | `https://openrouter.ai/api/v1`                                  |
| Ollama               | `http://localhost:11434/v1`                                     |
| vLLM, LM Studio, ... | the server's `/v1`                                              |

- Streams `delta.content` as text, and assembles `delta.tool_calls`,
  whose arguments arrive in fragments keyed by index, into whole calls.
- Reads usage from the final chunk (`stream_options.include_usage`).
- Maps failures to the typed `AiError`s the Anthropic provider raises, plus
  `AiToolsUnsupportedError` for a model without function calling.

**Environment:** `AI_MODEL` is required, checked at start. `AI_API_KEY`
is sent as a bearer token when set (Ollama needs none).
