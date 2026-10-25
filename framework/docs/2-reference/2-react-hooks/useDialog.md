# useDialog

## Import

```typescript
import { useDialog } from "@alepha/ui";
```

## Overview

Imperative dialog API. Returns an object with:

- `confirm({ title, description? })` → `Promise<boolean>`
- `alert({ title, description? })` → `Promise<void>`
- `prompt({ title, label?, defaultValue?, validate? })` → `Promise<string | null>`

Requires `DialogProvider` mounted in the tree.

## Examples

const dialog = useDialog();
if (await dialog.confirm({ title: "Delete?", destructive: true })) {
await api.delete();
}
