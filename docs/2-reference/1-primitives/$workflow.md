# $workflow

## Import

```typescript
import { $workflow } from "alepha/api/workflows";
```

## Overview

Declare a durable, multi-step workflow (saga).

Steps run sequentially; each step's result is persisted and passed to
later steps via `results`. On failure, completed steps are compensated
in reverse order (`onError: "compensate"`, the default) or the
execution is marked failed (`onError: "fail"`).

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `schema` | `TInput` | Yes | Zod schema for the workflow input payload. |
| `steps` | `Array&lt;WorkflowStep&lt;TInput&gt;&gt;` | Yes | Ordered list of steps |
| `onError` | `"compensate" \| "fail"` | No | Error strategy |
| `timeout` | `DurationLike` | No | Maximum total duration for the entire workflow. |
| `priority` | `WorkflowPriority` | No | Priority for the workflow's job dispatches. |
| `tags` | `string[]` | No | Tags for filtering/grouping in admin UI. |

