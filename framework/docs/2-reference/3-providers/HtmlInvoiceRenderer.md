# HtmlInvoiceRenderer

## Import

```typescript
import { HtmlInvoiceRenderer } from "@alepha/commerce/invoicing";
```

## Overview

Renders a print-ready, legally complete invoice as HTML.

Every element below is there because a French B2C invoice is invalid without
it: the seller's registered name, address and company number; the invoice's
own number and date; the buyer's name and address; per-line quantity and unit
price; the tax broken down per rate; and, when the seller is not liable for
VAT, the statutory notice printed _instead of_ the tax lines.

The layout is plain on purpose - an invoice is read by a customer once and by
an accountant twice, and neither wants a design.
