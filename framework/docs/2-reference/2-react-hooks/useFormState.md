# useFormState

## Import

```typescript
import { useFormState } from "alepha/react/form";
```

## Overview

Tracks whichever `form` the caller currently passes in, not only the one
it saw on the first render - same rationale as `useFormValues`. Without
this, a caller that swaps forms (via `useForm`'s `deps` parameter minting
a fresh `FormModel`) would keep the old model's `dirty`, `loading`,
`error` and `values` on screen. The new model has the same `id` unless the
caller changes it; when it does, the `form:changed` / `form:submit:*` /
`form:reset` listeners would also stay bound to the old `id`, so
`loading` would never turn on again and `dirty` would never move.

The re-seed on a form swap happens during render (not inside the
effect), so no frame paints the previous form's `dirty`/`loading`/
`error`/`values` under the new form's identity before the effect below
has a chance to re-subscribe.

## `error`

- With `{ form, path }`, it is that field's entry in `form.errors`, as a
  `FormValidationError` carrying the path and message. It is read from the
  model, so a field mounted after the failure (a tab, a collapsed object,
  an array row) shows it too.
- With the form alone, it is the last submit's error, whatever it was,
  until the next change.
