# Alepha - Ai Anthropic

## Installation

Part of the `alepha` package. Import from `alepha/ai/anthropic`.

```bash
npm install alepha
```

## Overview

Plugin for Alepha AI that talks to the Anthropic Messages API, over plain
`fetch`: streaming, tool use, prompt caching and typed errors.

Registering it makes `AnthropicAiProvider` the `AiProvider`, on every
runtime. It needs `AI_API_KEY` and `AI_MODEL` (or a `model` on each
`$ai`), and fails at start without them.

## API Reference

### Providers

- [`AnthropicAiProvider`](/docs/reference-providers-anthropicaiprovider) - AI provider for the Anthropic Messages API, over plain `fetch`.
