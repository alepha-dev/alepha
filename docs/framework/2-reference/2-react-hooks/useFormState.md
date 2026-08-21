# useFormState

## Import

```typescript
import { useFormState } from "alepha/react/form";
```

## Overview

Tracks whichever `form` the caller currently passes in, not only the one
it saw on the first render - same rationale as `useFormValues`. Without
this, a caller that swaps forms (via `useForm`'s `deps` parameter minting
a fresh `FormModel`) would keep this hook's `form:change` /
`form:submit:*` / `form:reset` listeners bound to the OLD form's `id`
forever: `loading` would never turn on again for the new form's
submissions, `dirty` would never move, and `values` would freeze on
whatever the old form last held.

The re-seed on a form swap happens during render (not inside the
effect), so no frame paints the previous form's `dirty`/`loading`/
`error`/`values` under the new form's identity before the effect below
has a chance to re-subscribe.
