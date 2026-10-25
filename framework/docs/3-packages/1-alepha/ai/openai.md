# Alepha - Ai Openai

## Installation

Part of the `alepha` package. Import from `alepha/ai/openai`.

```bash
npm install alepha
```

## Overview

Plugin for Alepha AI that talks the OpenAI Chat Completions wire format,
over plain `fetch`: OpenAI itself, and every compatible endpoint through
`AI_BASE_URL` (Workers AI over REST, OpenRouter, Ollama, vLLM).

Registering it makes `OpenAiCompatibleAiProvider` the `AiProvider`, on
every runtime. It needs `AI_MODEL` (or a `model` on each `$ai`) and fails
at start without one.

## API Reference

### Providers

- [`OpenAiCompatibleAiProvider`](/docs/reference-providers-openaicompatibleaiprovider) - AI provider for the OpenAI Chat Completions wire format, over plain
