# useSortableList

## Import

```typescript
import { useSortableList } from "@alepha/ui/sortable";
```

## Overview

A vertical list reordered by dragging or from the keyboard, on `@dnd-kit`
(pointer and touch sensors, and a keyboard move of its own).

It holds what every such list needs and nothing of how it looks: the
activation distance, a vertical-only modifier that keeps an item inside the
list, the drop index, the order held between a drop and the server's
answer, and the keyboard move with its screen-reader announcements. Each
item uses `useSortableItem`; the list draws `order` inside a
`DndContext` given `contextProps`.

The keyboard move is the list's own rather than `@dnd-kit`'s
`KeyboardSensor`: it moves by one place per arrow, inside a list that may
scroll, and says where the item is at each step.
