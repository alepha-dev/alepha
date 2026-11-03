# ReactVitalsProvider

## Import

```typescript
import { ReactVitalsProvider } from "alepha/react/vitals";
```

## Overview

Reports Core Web Vitals per page, as events: `react:vital:measured` for each
finalised metric, and `react:lcp:painted` when the main content has painted.

Opt-in: inject it from what consumes the events. It is not one of the
router's services, or every app would run five observers, one of them with a
`durationThreshold` of 16 ms.

```ts
class Vitals {
  provider = $inject(ReactVitalsProvider);

  measured = $hook({
    on: "react:vital:measured",
    handler: ({ metric, value, path }) => {
      navigator.sendBeacon("/vitals", JSON.stringify({ metric, value, path }));
    },
  });
}
```
