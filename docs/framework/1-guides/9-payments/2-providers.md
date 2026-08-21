# Payment Providers

A `PaymentProvider` is the bridge between Alepha's lifecycle and a real payment service provider. The abstract class defines eight required methods covering the full intent lifecycle, plus two a real provider should implement:

```typescript
abstract class PaymentProvider {
  createSession(intent, { returnUrl, authorize, ... }): Promise<{ url, providerRef }>;
  capturePayment(providerRef, amount): Promise<void>;
  voidPayment(providerRef): Promise<void>;
  refundPayment(providerRef, amount, options?): Promise<{ providerRef }>;
  parseWebhook(request): Promise<{ providerRef, status, raw }>;
  createPaymentMethod(userId, token): Promise<CreatePaymentMethodResult>;
  deletePaymentMethod(providerRef): Promise<void>;
  expireSession(providerRef): Promise<void>;

  // optional: embedded card fields (Stripe Payment Element and friends);
  // PaymentService.supportsEmbeddedPayment() dispatches on its presence
  createElementSession?(intent, options): Promise<ElementSession>;

  // non-abstract, returns null by default - but providers SHOULD override it:
  // it is the reconciliation path when a webhook goes missing. Both shipped
  // providers do.
  retrieveSessionStatus(providerRef): Promise<SessionStatus | null>;
}
```

`createSession` options also carry Connect-style fields (`stripeAccount`, `applicationFeeAmount`, `customerEmail`), and `refundPayment` accepts `{ stripeAccount }`.

`PaymentService` and `PaymentMethodService` call these methods; you never call them directly.

Two implementations ship with the framework: `@alepha/payments-stripe` and `@alepha/payments-mollie`. Both compose with `AlephaApiPayments` the same way:

```typescript
import { AlephaApiPayments } from "alepha/api/payments";
import { AlephaPaymentsStripe } from "@alepha/payments-stripe";
// or:
import { AlephaPaymentsMollie } from "@alepha/payments-mollie";

const alepha = Alepha.create()
  .with(AlephaApiPayments)
  .with(AlephaPaymentsStripe);
```

The provider module declares `register: alepha.with({ provide: PaymentProvider, use: ... })` - the `MemoryPaymentProvider` default is overridden automatically.

## Stripe

```bash
yarn add @alepha/payments-stripe
```

### Environment

| Variable                        | Description                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`             | API key (`sk_test_...` / `sk_live_...`).                                              |
| `STRIPE_WEBHOOK_SECRET`         | Signing secret returned by `webhookEndpoints.create`.                                 |
| `STRIPE_PUBLISHABLE_KEY`        | Required for the embedded Payment Element - `createElementSession` throws without it. |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Signing secret for Connect webhooks; gates `parseConnectWebhook`.                     |

### Webhook security

Stripe signs webhook payloads with HMAC-SHA256. `StripePaymentProvider.parseWebhook` calls `stripe.webhooks.constructEventAsync(body, signature, secret)` (the async variant - the sync one relies on Node's synchronous crypto, which doesn't exist on workerd) and throws if the signature is missing or invalid. This is the only authentication on `/api/payments/webhook`.

### Webhook provisioning

Provision the webhook endpoint yourself using the Stripe SDK - `stripe.webhookEndpoints.create({ url, enabled_events })` where `url` is `${baseUrl}/api/payments/webhook`. Store the returned signing secret as `STRIPE_WEBHOOK_SECRET` on the deployed worker so `StripePaymentProvider.parseWebhook` can verify incoming payloads.

Earlier versions shipped an `AlephaCliPlatformStripePlugin` that registered a `PlatformHook` to do this during `alepha platform up`. That mechanism was removed: deploy frequency and webhook lifetime are different concerns. Webhook setup happens once per environment, not on every deploy - handle it from your provisioning code.

### Customer mapping

`StripePaymentProvider` caches a mapping of Alepha `userId` → Stripe customer ID (TTL 30 days). On a cache miss it searches Stripe by `metadata.alepha_user_id` and creates a new customer if none is found.

### Saved payment methods

Stripe's tokenize-then-attach model maps directly: the client tokenizes a card via Stripe.js, posts the token to `POST /api/payments/payment-methods`, and `StripePaymentProvider.createPaymentMethod` calls `paymentMethods.attach(token, { customer })`.

## Mollie

```bash
yarn add @alepha/payments-mollie
```

### Environment

| Variable             | Description                                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `MOLLIE_API_KEY`     | Mollie test or live API key.                                                                                                              |
| `MOLLIE_WEBHOOK_URL` | _(optional)_ Public URL Mollie POSTs webhooks to. Typically `https://app.example.com/api/payments/webhook`. Omit in dev to skip webhooks. |

### Webhook security

Mollie does not sign webhook payloads. The body carries only `id=tr_xxx`. `MolliePaymentProvider.parseWebhook` re-fetches the payment via the authenticated SDK client - the fetch itself is the authentication boundary. An attacker can POST a fake id, but the lookup either misses or returns a payment whose state we already trust (because it came from Mollie's API, not the request body).

### Per-payment webhook URLs

Unlike Stripe (one global endpoint), Mollie's webhook URL is attached to each payment at create time. The provider reads `MOLLIE_WEBHOOK_URL` once and threads it into every `payments.create` call. There is no platform hook to provision because there is nothing to provision.

### Limitations

- **`createPaymentMethod` throws.** Mollie creates mandates implicitly via a `sequenceType: "first"` checkout payment - there is no tokenize-then-attach flow. For recurring billing, route the first payment through the checkout flow with a customer attached; subsequent off-session charges then use the mandate.
- **`deletePaymentMethod` is a no-op.** Mandates are tied to customers; the entity does not yet track the customer↔mandate relationship needed to revoke safely. A future iteration will call `customers.mandates.revoke`.
- **Manual capture (`authorize: true`)** is supported for cards only. Other methods (iDEAL, SEPA, Bancontact) reject the option at create time.

## Choosing a provider

| Criterion        | Stripe                                           | Mollie                                                         |
| ---------------- | ------------------------------------------------ | -------------------------------------------------------------- |
| Coverage         | Global; strong in US.                            | EU-focused; strong in NL/DE/BE/FR.                             |
| Methods          | Cards, Apple/Google Pay, ACH, SEPA, Klarna, etc. | Cards, iDEAL, Bancontact, SEPA, Klarna, gift cards, Apple Pay. |
| Webhook security | HMAC signature.                                  | Re-fetch by id.                                                |
| Saved cards      | Tokenize-then-attach.                            | Mandate-via-first-payment.                                     |
| Manual capture   | All card types.                                  | Cards only.                                                    |
| Platform fees    | Stripe Connect.                                  | Mollie Connect (OAuth).                                        |

For most EU SaaS apps either works; for marketplaces with US sellers, Stripe is the path of least resistance.

## Writing your own provider

Implement the contract and register it the same way. Both shipped providers use `implements` rather than `extends` - note that with `implements`, the normally-optional `retrieveSessionStatus` becomes required, which is a feature: it forces the reconciliation path to exist.

```typescript
import { $module } from "alepha";
import { AlephaApiPayments, PaymentProvider } from "alepha/api/payments";

class AdyenPaymentProvider implements PaymentProvider {
  // ... implement the lifecycle methods ...
}

export const AlephaPaymentsAdyen = $module({
  name: "alepha.payments.adyen",
  services: [AdyenPaymentProvider],
  imports: [AlephaApiPayments],
  register: (alepha) =>
    alepha.with({ provide: PaymentProvider, use: AdyenPaymentProvider }),
});
```

Three things to get right:

1. **`parseWebhook` must establish authenticity**: either signature verification or re-fetch. The webhook endpoint has no other auth.
2. **Status mapping is your contract with `PaymentService`.** The service understands `authorized`, `captured`, `failed`. Anything else is logged and ignored - use that to silently drop transient states (`open`, `pending`).
3. **Amounts are integers** in Alepha's storage (minor units / cents). PSPs that want decimal strings (Mollie) need a converter.
