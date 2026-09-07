# NotificationInboxChannel

## Import

```typescript
import { NotificationInboxChannel } from "alepha/api/notifications";
```

## Overview

The inbox, as the third implementation of the channel contract.

`addressable = true`: it delivers to a **person**, so it keeps the whole
gate - the suppression list, the app's preference provider and the
unsubscribe token. It is not a sink, so there is no
`NotificationSinkChannels` entry and `push()` still demands a contact.

Registered by default in `AlephaApiNotifications`' `services[]`, so an app
that declares an `inbox` block changes nothing to get it. The one thing it
does have to do is substitute `NotificationInboxRecipientProvider`,
since the default resolves nobody.

## ⚠️ This class holds no resolution state, and must not

The contact is resolved twice per message: once in `unavailable()`, to
decline before anything is rendered, and once in `render()`, to file the
row. The obvious saving is a field on the channel holding the last answer.

**Do not.** A channel is a service, so there is exactly one instance for
the whole container, and sends interleave at every `await`. A cached "last
resolved user" delivers one person's message into another person's inbox -
silently, under concurrency only, and never in a unit test. Two indexed
lookups by contact is the correct price.
