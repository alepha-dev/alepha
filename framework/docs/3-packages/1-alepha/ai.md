# Alepha - Ai

## Installation

Part of the `alepha` package. Import from `alepha/ai`.

```bash
npm install alepha
```

## Overview

AI models behind one provider contract, with no vendor SDK.

**Features:**

- `AiProvider`: one streamed `chat()` call, text deltas, tool calls and
  usage as typed events, and `complete()` to collect them
- `MemoryAiProvider`: the default, scripted in specs, and an explicit
  placeholder reply in development
- `SseReader`: the `text/event-stream` parser every vendor provider shares
- `AiToolSchema`: Zod to tool JSON Schema, in input mode

The vendor is the module the app registers, never an env string:
`AlephaAiCloudflare` (`alepha/ai/cloudflare`, the Workers AI binding),
`AlephaAiOpenai` (`alepha/ai/openai`, any OpenAI-compatible endpoint) or
`AlephaAiAnthropic` (`alepha/ai/anthropic`). Each substitutes
`AiProvider`; without one, `MemoryAiProvider` answers.

Everything runs on `fetch` and `ReadableStream`, so on Node, Bun and
Workers alike.

## API Reference

### Providers

- [`AiProvider`](/docs/reference-providers-aiprovider) - The contract every AI vendor implements: one streamed chat call.
- [`MemoryAiProvider`](/docs/reference-providers-memoryaiprovider) - The in-memory AI provider: the default everywhere, and the one specs drive.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable      | Type | Default | Description                                                                                                                                                                                                                            |
| ------------- | ---- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AI_API_KEY`  | text | -       | API key of the vendor (Anthropic, OpenAI, OpenRouter, the Workers AI REST API). Unused by the in-memory provider and by the Workers AI binding.                                                                                        |
| `AI_BASE_URL` | text | -       | Base URL in place of the default endpoint of the vendor, to go through Cloudflare AI Gateway, a local Ollama or any compatible endpoint.                                                                                               |
| `AI_MODEL`    | text | -       | Model id the vendor provider sends when a request names none, for example `claude-sonnet-5-5` or `@cf/meta/llama-4-scout-17b-16e-instruct`. The framework ships no fallback model id, so a vendor provider without one fails at start. |
