# NotificationInboxRecipientProvider

## Import

```typescript
import { NotificationInboxRecipientProvider } from "alepha/api/notifications";
```

## Overview

The seam through which an app turns a contact into one of its users.

`push({ contact })` hands **one string to every channel**. Email wants an
address, and the inbox wants somebody to file a message under. This is
how those two answers come from the same string without the notifications
module learning what a user is.

The framework owns the gate, the app owns the identity: the same split
`NotificationPreferenceProvider` already states, and the reason this
exists rather than an import of `alepha/api/users`, which would couple two
modules that share nothing today.

The default returns null, so an app that has not implemented it gets a
`skipped` receipt with the reason `unresolved-recipient` rather than a
crash - the same posture as an unimplemented preference provider allowing
everything.

## The contact arrives normalized

Trimmed and lower-cased, the way `NotificationSuppressionService` already
normalizes before it looks anything up. The sender hands the channel
`payload.contact` raw, and an implementation looking `users` up by an
address somebody typed with a capital letter would find nothing. Normalize
on the way in as well: what is stored in `users.email` is not guaranteed
to be normalized either.
