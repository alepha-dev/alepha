I thi# Billing Module Design

Generic payment processing for Alepha. Pluggable PSP providers with a built-in memory provider for development and testing.

## Deliverables

1. **`alepha/billing`** — core sub-module in `packages/alepha/src/billing/`
2. **`@alepha/billing-stripe`** — Stripe provider in `packages/@alepha/billing-stripe/`

## Architecture

Follows the `alepha/bucket` + `@alepha/bucket-s3` pattern:

- Abstract `BillingProvider` class in core defines the PSP contract
- `MemoryBillingProvider` ships as default fallback (dev/test — app works, payments are fake)
- `@alepha/billing-stripe` overrides via DI: `.with({ provide: BillingProvider, use: StripeBillingProvider })`
- Consumer registers with `alepha.with(AlephaBillingStripe)` or just `alepha.with(AlephaBilling)` for standalone mode

## Module Structure

```
packages/alepha/src/billing/
├── index.ts                          # AlephaBilling $module + exports
├── entities/
│   ├── paymentIntents.ts
│   ├── paymentMethods.ts
│   └── refunds.ts
├── schemas/
│   ├── intentSchemas.ts              # create, capture, query, resource
│   ├── paymentMethodSchemas.ts       # create, query, resource
│   └── refundSchemas.ts              # create, query, resource
├── controllers/
│   ├── BillingController.ts          # User: own methods, checkout
│   └── AdminBillingController.ts     # Admin: list intents, force refund, record cash, webhook
├── services/
│   ├── BillingService.ts             # Intent lifecycle
│   └── PaymentMethodService.ts       # CRUD for tokenized payment methods
├── providers/
│   ├── BillingProvider.ts            # Abstract class — PSP contract
│   └── MemoryBillingProvider.ts      # Fake PSP for dev/test
└── __tests__/

packages/@alepha/billing-stripe/
├── package.json                      # peerDep on alepha, dep on stripe
├── src/
│   ├── index.ts                      # AlephaBillingStripe $module
│   └── providers/
│       └── StripeBillingProvider.ts   # Stripe Checkout + Payment Intents
```

## Entities

### PaymentIntent

The central entity tracking a single payment attempt.

```typescript
export const paymentIntents = $entity({
  name: "payment_intents",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    organizationId: db.organization(),
    amount: t.integer(),                // smallest currency unit (cents)
    currency: t.text({ size: "short" }),  // ISO 4217 ("eur", "usd")
    status: t.enum([
      "created",
      "processing",
      "authorized",
      "captured",
      "voided",
      "failed",
      "cancelled",
      "refunded",
    ]),
    providerRef: t.optional(t.text()),     // PSP reference ID
    providerRaw: t.optional(t.json()),     // raw PSP response for debugging
    metadata: t.optional(t.json()),        // caller-defined context (orderId, etc.)
    paymentMethodId: t.optional(t.uuid()),
    userId: t.optional(t.uuid()),
  }),
});
```

### PaymentMethod

Tokenized card/wallet stored for a user. No raw card data.

```typescript
export const paymentMethods = $entity({
  name: "payment_methods",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    organizationId: db.organization(),
    userId: t.uuid(),
    type: t.text({ size: "short" }),       // "card", "wallet", "bank_transfer"
    brand: t.optional(t.text({ size: "short" })),  // "visa", "mastercard"
    last4: t.optional(t.text({ size: "short" })),
    expMonth: t.optional(t.integer()),
    expYear: t.optional(t.integer()),
    isDefault: t.boolean(),
    providerRef: t.text(),                // PSP token/method ID
  }),
});
```

### Refund

Partial or full refund against a captured intent.

```typescript
export const refunds = $entity({
  name: "refunds",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    organizationId: db.organization(),
    intentId: t.uuid(),                   // FK -> paymentIntents
    amount: t.integer(),                  // refund amount in cents
    status: t.enum(["pending", "processing", "completed", "failed"]),
    reason: t.optional(t.text()),
    providerRef: t.optional(t.text()),
  }),
});
```

## Payment Intent Lifecycle

```
created -> processing -> authorized -> captured -> (refunded)
                      -> captured (direct, no auth step)
                      -> failed
         -> cancelled
authorized -> voided
```

Status transition guards enforced by `BillingService`:

- `capture` only from `authorized`
- `void` only from `authorized`
- `refund` only from `captured`
- `cancel` only from `created`
- `handleWebhook` transitions from `processing` to `authorized`, `captured`, or `failed`

## BillingProvider (Abstract Contract)

```typescript
export abstract class BillingProvider {
  /**
   * Create a checkout session with the PSP.
   * Returns a URL to redirect the user to, and the PSP's reference ID.
   */
  abstract createSession(
    intent: PaymentIntentEntity,
    options: { returnUrl: string; authorize?: boolean },
  ): Promise<{ url: string; providerRef: string }>;

  /**
   * Capture a previously authorized payment.
   * Amount can differ from the original authorization (partial capture).
   */
  abstract capturePayment(providerRef: string, amount: number): Promise<void>;

  /**
   * Void/cancel a previously authorized payment before capture.
   */
  abstract voidPayment(providerRef: string): Promise<void>;

  /**
   * Refund a captured payment (partial or full).
   */
  abstract refundPayment(
    providerRef: string,
    amount: number,
  ): Promise<{ providerRef: string }>;

  /**
   * Parse an incoming PSP webhook request into a normalized event.
   */
  abstract parseWebhook(
    request: Request,
  ): Promise<{ providerRef: string; status: string; raw: unknown }>;

  /**
   * Store a payment method token with the PSP.
   */
  abstract createPaymentMethod(
    userId: string,
    token: string,
  ): Promise<{
    providerRef: string;
    type: string;
    brand?: string;
    last4?: string;
    expMonth?: number;
    expYear?: number;
  }>;

  /**
   * Delete a stored payment method from the PSP.
   */
  abstract deletePaymentMethod(providerRef: string): Promise<void>;
}
```

### MemoryBillingProvider

Ships with the core module. Implements all methods with in-memory state:

- `createSession()` returns a fake checkout URL (`/billing/mock-checkout/:intentId`) and auto-generated ref
- Auto-transitions intents through lifecycle with no real PSP
- Includes test assertion helpers: `wasCharged(ref)`, `wasRefunded(ref)`, `getIntents()`

### Module Registration

```typescript
export const AlephaBilling = $module({
  name: "alepha.billing",
  services: [
    BillingProvider,
    MemoryBillingProvider,
    BillingService,
    PaymentMethodService,
    BillingController,
    AdminBillingController,
  ],
  register: (alepha) => {
    alepha.with({
      optional: true,
      provide: BillingProvider,
      use: MemoryBillingProvider,
    });
  },
});
```

## BillingService

Orchestrates the payment lifecycle. All PSP interaction goes through the injected `BillingProvider`.

| Method | What it does | Emits |
|--------|-------------|-------|
| `createIntent(amount, currency, metadata?, options?)` | Creates intent in `created` status | — |
| `createSession(intentId, returnUrl)` | Calls provider, transitions to `processing`, returns checkout URL | — |
| `handleWebhook(request)` | Parses PSP webhook, updates intent status | `billing:authorized` / `billing:captured` / `billing:failed` |
| `capture(intentId, finalAmount?)` | Captures authorized intent | `billing:captured` |
| `void(intentId)` | Voids authorized intent | `billing:voided` |
| `refund(intentId, amount, reason?)` | Creates refund record, calls provider | `billing:refunded` |
| `recordCashPayment(amount, currency, metadata?)` | Creates intent directly in `captured` status, no PSP | `billing:captured` |
| `cancel(intentId)` | Cancels a `created` intent | — |

## Events

Typed via module augmentation. Consumers listen with `$hook()`.

```typescript
declare module "alepha" {
  interface Hooks {
    "billing:authorized": { intentId: string; amount: number; currency: string; metadata?: unknown };
    "billing:captured":   { intentId: string; amount: number; currency: string; metadata?: unknown };
    "billing:failed":     { intentId: string; amount: number; currency: string; metadata?: unknown };
    "billing:voided":     { intentId: string; amount: number; currency: string; metadata?: unknown };
    "billing:refunded":   { intentId: string; refundId: string; amount: number; currency: string; metadata?: unknown };
  }
}
```

### Example consumer (passeo/sales):

```typescript
class OrderService {
  protected readonly orderPaid = $hook({
    on: "billing:captured",
    handler: async ({ intentId, metadata }) => {
      await this.markOrderPaid(metadata.orderId);
    },
  });
}
```

## Controllers

### BillingController (User — `/api/billing`)

| Action | Method | Path | Auth | Does |
|--------|--------|------|------|------|
| `listPaymentMethods` | GET | `/billing/payment-methods` | authenticated | List current user's saved payment methods |
| `addPaymentMethod` | POST | `/billing/payment-methods` | authenticated | Tokenize and store a new payment method |
| `removePaymentMethod` | DELETE | `/billing/payment-methods/:id` | authenticated | Remove own payment method |
| `setDefaultPaymentMethod` | PATCH | `/billing/payment-methods/:id/default` | authenticated | Set as default |
| `createCheckout` | POST | `/billing/checkout` | authenticated | Create session + return checkout URL |

### AdminBillingController (Admin — `/api/admin/billing`)

| Action | Method | Path | Permission | Does |
|--------|--------|------|------------|------|
| `listIntents` | GET | `/admin/billing/intents` | `billing:read` | Paginated list with filters |
| `getIntent` | GET | `/admin/billing/intents/:id` | `billing:read` | Full detail including `providerRaw` |
| `captureIntent` | POST | `/admin/billing/intents/:id/capture` | `billing:write` | Capture authorized intent |
| `voidIntent` | POST | `/admin/billing/intents/:id/void` | `billing:write` | Void authorized intent |
| `refundIntent` | POST | `/admin/billing/intents/:id/refund` | `billing:write` | Issue partial/full refund |
| `cancelIntent` | POST | `/admin/billing/intents/:id/cancel` | `billing:write` | Cancel created intent |
| `recordCash` | POST | `/admin/billing/cash` | `billing:write` | Record cash payment |
| `webhook` | POST | `/billing/webhook` | none | PSP webhook (verified by provider, not under `/admin`) |

## `@alepha/billing-stripe`

### package.json

- `peerDependencies`: `alepha`
- `dependencies`: `stripe`

### StripeBillingProvider

Implements `BillingProvider` using:

- **Stripe Checkout Sessions** for `createSession()`
- **Stripe Payment Intents** for `capturePayment()`, `voidPayment()`
- **Stripe Refunds API** for `refundPayment()`
- **Stripe webhook signature verification** in `parseWebhook()` via `stripe.webhooks.constructEvent()`
- **Stripe Payment Methods + Customers** for `createPaymentMethod()` / `deletePaymentMethod()`

### Configuration

Via `$env()`:

- `STRIPE_SECRET_KEY` — API key
- `STRIPE_WEBHOOK_SECRET` — webhook signing secret

### Module Registration

```typescript
export const AlephaBillingStripe = $module({
  name: "alepha.billing.stripe",
  services: [StripeBillingProvider],
  register: (alepha) =>
    alepha
      .with({ provide: BillingProvider, use: StripeBillingProvider })
      .with(AlephaBilling),
});
```

Consumer registers: `alepha.with(AlephaBillingStripe)` — everything wired automatically.

## Integration Pattern

### Direct capture (simple purchase):

1. Consumer calls `billingService.createIntent(1500, "eur", { orderId })`
2. Consumer calls `billingService.createSession(intentId, returnUrl)` → gets checkout URL
3. User pays on PSP checkout page
4. PSP webhook → `billingService.handleWebhook()` → intent transitions to `captured`
5. `billing:captured` event emitted → consumer handles it

### Two-step (authorize + capture):

1. Consumer calls `billingService.createIntent(1500, "eur", { orderId }, { authorize: true })`
2. Consumer calls `billingService.createSession(intentId, returnUrl)`
3. PSP webhook → `billing:authorized`
4. Later, consumer calls `billingService.capture(intentId, finalAmount)`
5. `billing:captured` event emitted

### Cash payment:

1. Admin calls `billingService.recordCashPayment(1500, "eur", { orderId })`
2. Intent created directly in `captured` status
3. `billing:captured` event emitted
