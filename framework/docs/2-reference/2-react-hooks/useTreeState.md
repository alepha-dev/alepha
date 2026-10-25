# useTreeState

## Import

```typescript
import { useTreeState } from "@alepha/ui/tree";
```

## Overview

The state a `TreeView` needs and a consumer would otherwise write again:
collapse, inline rename, the drag gesture and the drop guard.

**Selection is deliberately not here.** No two consumers hold it the same
way (one derives it from the URL, another from local state), so a hook that
owned it would need a controlled/uncontrolled pair for a value it can never
be the source of. `TreeView` takes `selectedId` and `onSelect` directly.

Neither is anything that needs to know what an ancestor means in the
consumer's URL space: auto-expanding the branches above the selected node,
revealing a node by some other identifier, seeding the initial collapse set.
Those stay with the consumer, and `expandOne` plus the controlled pair is
everything they need from here.
