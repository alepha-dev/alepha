# useFormValues

## Import

```typescript
import { useFormValues } from "alepha/react/form";
```

## Overview

Hook to subscribe to all form values.
Re-renders on every field change - use only when needed (debug panels, live previews).

Tracks whichever `form` instance the caller currently passes in, not
only the one it saw on the first render. `useForm`'s `deps` parameter
(see `useForm.ts`) lets a caller mint a brand new `FormModel`, with a
fresh values store, on a dependency change. Its `id` is the caller's, or
`useId()`'s, so it changes only when the caller changes it: the model's
identity is what says the form changed. Without re-tracking here, this
hook would keep the values of the model it first saw, and when the `id`
changed too, keep listening for `form:changed` events carrying the old
one. The render-time re-seed below (rather
than resetting inside the effect) avoids painting one frame of the
previous form's values before the effect has a chance to run.
