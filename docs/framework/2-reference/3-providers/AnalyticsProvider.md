# AnalyticsProvider

## Import

```typescript
import { AnalyticsProvider } from "alepha/api/analytics";
```

## Overview

Where a dataset's rows live.

**Each provider owns its own tiering.** Nothing above this seam knows that
hot and rolled data exist, because the two shipped backends tier into
different *systems* rather than different tables: the relational provider
keeps a raw table and a rolled table in one database, while the Analytics
Engine provider keeps hot rows in Analytics Engine and rolled rows in a
relational store. A tier-aware planner above this line would have to know
both layouts.

