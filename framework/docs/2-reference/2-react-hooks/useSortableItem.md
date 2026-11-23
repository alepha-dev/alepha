# useSortableItem

## Import

```typescript
import { useSortableItem } from "@alepha/ui/sortable";
```

## Overview

One item of a `useSortableList`: the element both dragged and dropped
on, and only the pointer listener of `@dnd-kit`. The keyboard move is the
list's own (`onKeyDown`), on whichever element of the item takes focus.
