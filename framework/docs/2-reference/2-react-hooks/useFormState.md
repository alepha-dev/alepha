# useFormState

## Import

```typescript
import { useFormState } from "alepha/react/form";
```

## Overview

Tracks whichever `form` the caller currently passes in, not only the one
it saw on the first render - same rationale as `useFormValues`. Without
this, a caller that swaps forms (via `useForm`'s `deps` parameter minting
a fresh `FormModel`) would keep this hook's `form:changed` /
`form:submit:*` / `form:reset` listeners bound to the OLD form's `id`
forever: `loading` would never turn on again for the new form's
submissions, `dirty` would never move, and `values` would freeze on
whatever the old form last held.

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
