# useToast

## Import

```typescript
import { useToast } from "@alepha/ui";
```

## Overview

Imperative toast hook. Requires a `<Toaster />` mounted somewhere in
the tree (`Toaster`, from the same `@alepha/ui` module).

The underlying library (currently sonner) is an implementation
detail, never exported from this module. Consumers depend on the
`Toast` interface, not on sonner's API. This keeps the door open to
swapping libraries or adding cross-cutting behavior (dedup,
rate-limit, branded icons) without rippling through call sites.

## Examples

const toast = useToast();
toast.success("Saved");
toast.error(err.message, { description: "Please try again" });
toast.show(message, intent, { action: { label: "Undo", onClick } });
