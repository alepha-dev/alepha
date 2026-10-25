# JobRetentionProvider

## Import

```typescript
import { JobRetentionProvider } from "alepha/api/jobs";
```

## Overview

Turns a job's declared `retention` into the rule each status actually
follows, once, at registration.

It is the single place that knows the defaults, so the inline cron path, the
outbox path, the trim and the admin payload cannot disagree about a job. A
cron that declares `retry` runs through the outbox like a queue job, and
still keeps its successes by its cadence, because the rule is decided by the
registration and not by the path that happens to write the row.
