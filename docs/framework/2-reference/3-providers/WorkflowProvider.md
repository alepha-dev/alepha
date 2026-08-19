# WorkflowProvider

## Import

```typescript
import { WorkflowProvider } from "alepha/api/workflows";
```

## Overview

The workflow engine: persists executions and step state, dispatches
steps (inline or through the `$job` queue via `WorkflowJobs`),
retries with backoff, compensates in reverse order on failure, and
recovers crashed or timed-out executions via sweeps.

