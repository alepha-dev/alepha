# NotificationPreferenceProvider

## Import

```typescript
import { NotificationPreferenceProvider } from "alepha/api/notifications";
```

## Overview

The seam through which an app answers "does this contact accept this
message?" from its own preference store.

The framework owns the gate, the app owns the preference. Suppression (an
unsubscribe link, a bounce, a complaint) is framework state and lives in
`notification_suppressions`. Everything else is an app's own product
decision, with its own table and its own shape, and the framework
deliberately never learns it: it only consumes the boolean.

The default allows everything, so an app that has no preferences does not
have to say so.

## An implementation is expected to consider both axes

"No email at all" and "no email in this category" are different answers,
and the second is what an unsubscribe link expresses. Both arrive in the
arguments; answering on `template` alone is the mistake to avoid.
