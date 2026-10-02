# useFormQuerySync

## Import

```typescript
import { useFormQuerySync } from "alepha/react/form";
```

## Overview

Two-way bind a `useForm` instance to the URL query params, keyed
per-field (so the URL stays human-readable: `?status=new&zone=ops`).

Direction 1 - URL → form:

- On mount AND every time one of the watched query keys changes
  (typically via browser back/forward or external `router.push`),
  call `form.input[key].set(value)` for each listed key. Missing /
  empty params clear the field (set to `undefined`).

Direction 2 - form → URL:

- Subscribe to the form's `form:change` event for the listed keys.
  Each emission writes the current values for all listed keys to the
  URL via `router.setQueryParams` (replace-state, no history spam).
  Empty values (`undefined` / `""`) are stripped from the URL so the
  address bar stays clean.

Replaces ad-hoc `localStorage` filter persistence: the URL becomes
the canonical store, so the view is shareable via copy-paste and
navigable via back/forward.

applications, exported from `alepha/react/form` and covered by its own
spec. Do not delete it for being unreferenced.

## Examples

const form = useForm({ schema: z.object({ status: z.string(), q: z.string() }) });
useFormQuerySync(form, { keys: ["status", "q"] });
