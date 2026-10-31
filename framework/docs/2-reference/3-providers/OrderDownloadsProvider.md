# OrderDownloadsProvider

## Import

```typescript
import { OrderDownloadsProvider } from "alepha";
```

## Overview

What can be downloaded for an order: read by the confirmation email and the
thank-you page, answered by `@alepha/commerce/downloads`.

In the core, and a list rather than a substitution, for the reason
`OrderDocumentsProvider` is: notifications and downloads are siblings, and two
plugins cannot be ordered. A deployment with no downloads gets an empty list.
