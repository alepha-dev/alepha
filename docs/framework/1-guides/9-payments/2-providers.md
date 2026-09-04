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
  // it is the reconciliation path when a webhook goes missing. The shipped
  // provider does.
  retrieveSessionStatus(providerRef): Promise<SessionStatus | null>;
}
```

`createSession` options also carry Connect-style fields (`stripeAccount`, `applicationFeeAmount`, `customerEmail`), and `refundPayment` accepts `{ stripeAccount }`.

`PaymentService` and `PaymentMethodService` call these methods; you never call them directly.

One implementation ships with the framework, `@alepha/payments-stripe`. It composes with `AlephaApiPayments` like this:

```typescript
import { AlephaApiPayments } from "alepha/api/payments";
import { AlephaPaymentsStripe } from "@alepha/payments-stripe";

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
