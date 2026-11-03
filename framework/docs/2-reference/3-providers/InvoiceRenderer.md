# InvoiceRenderer

## Import

```typescript
import { InvoiceRenderer } from "@alepha/commerce/invoicing";
```

## Overview

Turns an invoice row into something a customer can keep.

### Why the default is HTML and not PDF

Every PDF library is a heavy dependency, several do not run on Cloudflare
Workers, and none of them is the right choice for every deployment. Forcing
one into this package would tax every consumer for a format some of them do
not need - a POS prints a receipt on a thermal printer and never makes a PDF.

So the default renders semantic, print-ready HTML - which browsers turn into a
PDF on demand, and which is legally sufficient - and a consumer that wants a
real PDF substitutes this provider:

```ts
alepha.with({ provide: InvoiceRenderer, use: PdfInvoiceRenderer });
```
