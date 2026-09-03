# TaskCacheProvider

## Import

```typescript
import { TaskCacheProvider } from "alepha/command";
```

## Overview

Remembers that a task passed against a particular set of inputs, so an
identical run can skip it.

The store holds no output, only the fact of a pass. That is a deliberate
limit rather than a first cut: restoring a task's artifacts means knowing
what they were, and a wrong answer there is a build that looks present and
is not. A task whose result is a file on disk is served by
`BuildFreshness` and `alepha build --if-stale`, which compares the artifact
against its sources rather than trusting a record of the past.

⚠️ Everything a task reads must be in its key. What is in the key is the
caller's judgement, and a caller that forgets an input gets a cache that
says a task passed when it has never been run against the code in front of
it. That is why this is opt-in per task rather than a mode, and why the
pipeline that uses it announces every skip.
