# useToast

> Use this hook to access the Toast Service for showing notifications.

## Import

```typescript
import { useToast } from "@alepha/ui/styles";
```

## Overview

Use this hook to access the Toast Service for showing notifications.

## Examples

```tsx
const toast = useToast();
toast.success({ message: "Operation completed successfully!" });
toast.error({ title: "Error", message: "Something went wrong" });
```

