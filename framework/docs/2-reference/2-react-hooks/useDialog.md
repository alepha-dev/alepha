# useDialog

## Import

```typescript
import { useDialog } from "@alepha/ui";
```

## Overview

Imperative dialog API. Returns an object with:

- `confirm({ title, description?, confirmText? })` → `Promise<boolean>`;
  with `confirmText`, the user types it before the button enables
- `alert({ title, description? })` → `Promise<void>`
- `prompt({ title, label?, defaultValue?, validate? })` → `Promise<string | null>`

Requires `DialogProvider` mounted in the tree.

## Examples

const dialog = useDialog();
if (await dialog.confirm({ title: "Delete?", destructive: true })) {
await api.delete();
}
