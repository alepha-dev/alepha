# Alepha - Ai Cloudflare

## Installation

Part of the `alepha` package. Import from `alepha/ai/cloudflare`.

```bash
npm install alepha
```

## Overview

Plugin for Alepha AI that runs models on the Workers AI binding
(`env.AI`): no API key, no HTTP.

On Workers, registering it makes `WorkersAiProvider` the `AiProvider`, and
the Cloudflare build declares the `ai` binding. Off Workers (`yarn dev` on
Node, the specs) it substitutes nothing, so the app falls back to
`AlephaAi`'s default, or to another vendor module registered beside it
(`AlephaAiOpenai` on Workers AI's REST endpoint, for the same models).

## API Reference

### Providers

- [`WorkersAiProvider`](/docs/reference-providers-workersaiprovider) - AI provider on the Workers AI binding (`env.AI.run`): no API key, no

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable        | Type | Default | Description                                                                                                              |
| --------------- | ---- | ------- | ------------------------------------------------------------------------------------------------------------------------ |
| `AI_BINDING`    | text | AI      | Name of the Workers AI binding (env.AI) the Workers AI provider calls. The Cloudflare build declares it under this name. |
| `AI_GATEWAY_ID` | text | -       | Optional Cloudflare AI Gateway id the binding routes its calls through, for logs, caching and rate limits.               |
