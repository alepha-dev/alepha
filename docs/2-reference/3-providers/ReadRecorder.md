# ReadRecorder

## Import

```typescript
import { ReadRecorder } from "alepha";
```

## Overview

Records, for one request, the reads that make a page personal (#E78).

Installed in the request's store fork by the page handler
(`StateManager.startRecording`); every nested fork reaches it through
the parent walk, so middleware, render hooks, loaders, in-process actions
and the React render all report to the same recorder.

Fail closed: the caller decides what is personal, and anything it reports
here makes the verdict personal. A wrong report costs a cache miss, never a
leak.
