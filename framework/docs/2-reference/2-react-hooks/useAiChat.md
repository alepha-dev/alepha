# useAiChat

## Import

```typescript
import { useAiChat } from "@alepha/ui/ai";
```

## Overview

The state and actions of an assistant conversation, without any UI: what
`<AiChat />` is built on, for an app that wants its own.

- `send(message)` starts a turn in the current conversation (a new one
  first), with the current route and the innermost `useAiContext()`.
- A turn that pauses on a mutation sets `pending`; `approve()` or `deny()`
  answers it with the call id only, never the input: the server runs the
  input it stored.
- A turn that pauses on a client tool runs it here and resumes with its
  result, on its own: `navigate` (by page name, through the typed router),
  `fillForm` (only a form offered with `useAiContext({ form })`, never
  submitted), and any `clientTools` the app passes.
- `open(id)` loads a stored conversation; `open()` starts a new one.

Every action resolves a `RunResult` and never rejects, as `useAction` does.
