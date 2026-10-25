# useAiContext

## Import

```typescript
import { useAiContext } from "@alepha/ui/ai";
```

## Overview

Declare what the current page shows the assistant: a short `page` name,
the `data` it displays, and optionally the `form` the assistant may fill
(never submit). Every turn sent while the page is mounted carries the
current route and the innermost declared context.

## Examples

```tsx
const InvoicePage = (props: InvoicePageProps) => {
  const form = useForm({ schema: invoiceSchema, handler: save });
  useAiContext({ page: "invoice", data: props.invoice, form });
  return <form {...form.props}>...</form>;
};
```
