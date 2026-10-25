# Alepha - Api Ai

## Installation

Part of the `alepha` package. Import from `alepha/api/ai`.

```bash
npm install alepha
```

## Overview

The server side of an in-app assistant: conversations stored per user,
chat and resume streams over `$sse`, a per-user token budget and turn
rate, and a retention sweep.

**Features:**

- `POST /api/ai/chat` and `POST /api/ai/conversations/:id/resume`
  (`$sse`), `GET /api/ai/conversations` and `GET /api/ai/conversations/:id`,
  all `$secure()` and scoped to the caller
- `ai_conversations` and `ai_messages` entities (the app generates their
  migrations, as for every `alepha/api/*` module)
- the `api.ai` parameter: `budgetTokens`, `budgetWindowHours`,
  `turnsPerMinute`, `retentionDays`, editable at runtime

The assistant itself is the app's `$ai`: its prompt and its tools. With
several, a chat names the one it talks to.

⚠️ Register the vendor module (`AlephaAiCloudflare`, `AlephaAiOpenai`,
`AlephaAiAnthropic`) BEFORE this one: registering this module registers
`alepha/ai`, and the first provider substituted is the one used.
