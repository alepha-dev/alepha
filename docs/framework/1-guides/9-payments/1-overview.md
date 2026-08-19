# Payments

Alepha provides a provider-agnostic payments layer through `alepha/api/payments`. The framework owns the data model and lifecycle (intents, captures, refunds, payment methods); concrete payment service providers (PSPs) like Stripe or Mollie plug in via the `PaymentProvider` abstract class.

The same application code works against any provider - swap implementations without touching controllers, services, or hooks.

## The model

Three entities anchor the data:

| Entity | Role |
|---|---|
| `paymentIntents` | The unit of value transfer. Tracks status across the lifecycle: `created → processing → authorized → captured → refunded` (with branches for `failed`, `voided`, `cancelled`, `expired`). |
| `paymentMethods` | Saved cards / mandates tied to a user, with provider reference + masked metadata (`brand`, `last4`, `expMonth`, `expYear`). |
| `refunds` | Per-refund records linked to a captured intent. Supports partial and multi-step refunds. |

Every state transition emits a hook on Alepha's event bus:

```typescript
"payments:authorized" | "payments:captured" | "payments:failed"
"payments:voided" | "payments:refunded" | "payments:cancelled"
"payments:expired"
```

`payments:expired` is emitted by the stale-intent sweep described above - wire it if your fulfilment or notification code needs to release a reservation when a checkout is abandoned.

Your own modules (accounting, notifications, fulfilment) listen via `$hook` - they never call the PSP directly.

> **Recurring billing** is deliberately out of scope: let your PSP own it. Create
> the subscription with the provider (e.g. a Stripe Checkout in
> `mode: "subscription"`), then reconcile its status from webhooks into whatever
> field gates access in your app. Charging on your own cron means holding cards,
> reimplementing dunning, and diverging from the PSP's source of truth.

## Registering the module

```typescript check
import { Alepha } from "alepha";
import { AlephaApiPayments } from "alepha/api/payments";

const alepha = Alepha.create().with(AlephaApiPayments);
```

Out of the box this gives you:

- `POST /api/payments/checkout`: create a checkout session, returns redirect URL.
- `GET/POST/DELETE/PATCH /api/payments/payment-methods/...`: list, add, remove, set default.
- `POST /api/payments/webhook`: PSP webhook ingress (no `$secure` middleware; the provider verifies authenticity).
- `/api/admin/payments/...`: capture, void, refund, cancel, list intents, record cash payments.
- A cron running every 15 minutes (`api:payments:expireStaleIntents`, configurable via the `paymentsConfig` atom's `expireStaleIntentsCron`) that expires intents stuck in `processing` for more than 30 minutes.

`AlephaApiPayments` registers `MemoryPaymentProvider` as the default provider - you can boot the module with no PSP configured and exercise the full flow end-to-end via the mock checkout page at `/payments/mock-checkout/:id`. The page is gated on `MemoryPaymentProvider` outside production; `mockCheckoutOptions.allowInProduction` is the documented escape hatch if you truly need it live.

## Creating a payment

The high-level service is `PaymentService`. A typical "buy a one-off thing" flow:

```typescript
import { $inject, z } from "alepha";
import { $repository } from "alepha/orm";
import { $action } from "alepha/server";
import { $secure } from "alepha/security";
import { PaymentService } from "alepha/api/payments";
import { productEntity } from "./entities/product.ts";

class CheckoutController {
  protected readonly payments = $inject(PaymentService);
  protected readonly products = $repository(productEntity);

  buy = $action({
    method: "POST",
    path: "/checkout",
    use: [$secure()],
    schema: {
      body: z.object({ productId: z.uuid() }),
      response: z.object({ url: z.text() }),
    },
    handler: async ({ body, user }) => {
      const product = await this.products.getById(body.productId);

      const intent = await this.payments.createIntent(
        product.priceCents,
        product.currency,
        { productId: product.id },
        { userId: user.id },
      );

      const session = await this.payments.createSession(
        intent.id,
        "https://app.example.com/orders/success",
      );

      return { url: session.url };
    },
  });
}
```

Then react to the captured payment to fulfil the order:

```typescript
import { $hook } from "alepha";

class OrderFulfillment {
  protected readonly onPaid = $hook({
    on: "payments:captured",
    handler: async (event) => {
      const productId = (event.metadata as any)?.productId;
      if (!productId) return;
      await this.fulfill(productId, event.intentId);
    },
  });
}
```

## Authorize then capture

Pass `authorize: true` when creating the session to hold funds without capturing immediately. Useful for marketplace flows where the final amount isn't known up front:

```typescript
await this.payments.createSession(intent.id, returnUrl, true /* authorize */);
// ... later ...
await this.payments.capture(intent.id, finalAmountCents);
```

`capture()` accepts an amount lower than the authorized amount (partial capture). Higher amounts throw a `PaymentError`.

## Refunds

Refunds support partial amounts and multiple refunds against the same intent:

```typescript
const refund = await this.payments.refund(intentId, 500, "Customer dispute");
// intent.status becomes "partially_refunded" until the full amount is reached.
```

## Cash / offline payments

Skip the PSP entirely for in-person sales:

```typescript
await this.payments.recordCashPayment(2500, "EUR", { invoice: "INV-001" });
// Creates an intent already in "captured" state and emits payments:captured.
```

## Local development

With no provider configured, the `MemoryPaymentProvider` is wired in. `createSession` returns a URL to the bundled mock checkout page where you can confirm or cancel the payment manually - both cases drive the same hooks the real PSP would trigger.

In tests, inject a fresh memory provider and assert against its in-memory state:

```typescript
import { AlephaApiPayments, MemoryPaymentProvider, PaymentProvider } from "alepha/api/payments";

const alepha = Alepha.create()
  .with(AlephaApiPayments)
  .with({
    provide: PaymentProvider,
    use: MemoryPaymentProvider,
  });

const provider = alepha.inject(MemoryPaymentProvider);
expect(provider.wasCharged(intent.providerRef)).toBe(true);
```
