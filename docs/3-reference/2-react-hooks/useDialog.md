# useDialog

## Import

```typescript
import { useDialog } from "@alepha/ui/styles";
```

## Overview

Use this hook to access the Dialog Service for showing various dialog types.

## Examples

```tsx
const dialog = useDialog();
await dialog.alert({ title: "Alert", message: "This is an alert message" });
const confirmed = await dialog.confirm({ title: "Confirm", message: "Are you sure?" });
const input = await dialog.prompt({ title: "Input", message: "Enter your name:" });
```

