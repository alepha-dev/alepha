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
(see `useForm.ts`) lets a caller mint a brand new `FormModel` - a new
`id`, a fresh values store - on a dependency change; without re-tracking
here, this hook would keep listening for `form:change` events carrying
the OLD model's `id` forever, so the values it returns would freeze at
whatever the old form last held. The render-time re-seed below (rather
than resetting inside the effect) avoids painting one frame of the
previous form's values before the effect has a chance to run.
