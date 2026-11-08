# useActionForm

## Import

```typescript
import { useActionForm } from "alepha/react/form";
```

## Overview

A form that posts one action: its values are the action's `body`.

`action` is a client's (`useClient()`) or a local `$action`. The schema is
the action's own body schema, imported from the shared
`schemas/` file it is declared in (in the browser an action carries no
runtime schema). The type requires it to be that schema: one that drifts
from the action's body, or an action with no body, is a compile error.

A refusal from the server for the `body` (a `ValidationError` with
`part: "body"`, from request validation or thrown by the handler) lands
under every field it names, and is not toasted when every one of them
landed. A refusal of the `params`, `query` or `headers` is not the user's
input: it stays a form-level error, like any other failure.

```tsx
const form = useActionForm(api.createQuest, {
  schema: createQuestBodySchema,
  params: { projectId },
  onSuccess: (quest) => router.push("quest", { params: { id: quest.id } }),
});

return <AutoForm form={form} />;
```

Everything else is `useForm`'s: the same `FormModel`, events, submit
state, `validate` modes and `AutoForm` support. `deps` rebuilds the model,
as it does there.
