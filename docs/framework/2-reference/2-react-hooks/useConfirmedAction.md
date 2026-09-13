# useConfirmedAction

## Import

```typescript
import { useConfirmedAction } from "@alepha/ui/admin";
```

## Overview

The recurring admin pattern (confirm, then mutate, then toast) in one hook.
Wraps `useAction` (so failures still emit `react:action:error` for the
global toaster) plus `useDialog().confirm` and an optional success toast.

## Examples

```tsx
const remove = useConfirmedAction<[FileResource, () => void]>(
  {
    confirm: (file) => ({
      title: tr("admin.files.deleteTitle", { default: "Delete file" }),
      description: tr("admin.files.deleteConfirm", {
        default: `Delete "${file.name}"?`,
        args: [file.name],
      }),
      destructive: true,
    }),
    handler: async (file, refresh) => {
      await client.deleteFile({ params: { id: file.id } });
      refresh();
    },
    success: tr("admin.files.deleted", { default: "File deleted" }),
  },
  [client, tr],
);
// rowActions: onClick: (_f, { refresh }) => remove.run(file, refresh)
```
