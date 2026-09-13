# useTableSelection

## Import

```typescript
import { useTableSelection } from "@alepha/ui/table";
```

## Overview

Cross-page row selection for AlephaTable.

Selected rows are cached as full objects (not just keys) so paging away
and back never desynchronizes the selection count from the items handed
to bulk actions. `toggleAll` operates on the current page only;
`clearSelection` drops everything.
