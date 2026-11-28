# EventLogProvider

## Import

```typescript
import { EventLogProvider } from "alepha/api/analytics";
```

## Overview

Where an event log's rows live.

A seam of its own rather than more methods on `AnalyticsProvider`,
because the two never share a backend choice: a dataset may sit on
Analytics Engine, which samples, while an event log must always be exact.
An app bound to Analytics Engine therefore keeps its event logs on the
relational store.
