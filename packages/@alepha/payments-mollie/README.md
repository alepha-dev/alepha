# Alepha @alepha/payments-mollie

Mollie payment provider for `alepha/api/payments`.

## Installation

```bash
yarn add @alepha/payments-mollie
```

## Usage

```typescript
import { Alepha } from "alepha";
import { AlephaApiPayments } from "alepha/api/payments";
import { AlephaPaymentsMollie } from "@alepha/payments-mollie";

const alepha = Alepha.create()
  .with(AlephaApiPayments)
  .with(AlephaPaymentsMollie);
```

## API Reference

### Environment Variables

| Variable             | Type   | Default      | Description                                                                                   |
| -------------------- | ------ | ------------ | --------------------------------------------------------------------------------------------- |
| `MOLLIE_API_KEY`     | string | **Required** | Mollie test or live API key.                                                                  |
| `MOLLIE_WEBHOOK_URL` | string | _(optional)_ | Public webhook URL Mollie will POST to (e.g. `https://app.example.com/api/payments/webhook`). |

### Webhook security

Unlike Stripe, Mollie does not sign webhook payloads. The body only carries
the payment id; `MolliePaymentProvider.parseWebhook` re-fetches the payment
through the authenticated SDK client. The fetch itself is the authentication
boundary: an attacker can POST a fake id but cannot forge a payment state.

### Limitations

- `createPaymentMethod` throws: Mollie creates mandates implicitly via a
  `sequenceType: "first"` checkout payment, not by tokenize-then-attach.
- `deletePaymentMethod` is a no-op until mandate↔customer tracking lands.
- Manual capture (`authorize: true`) is supported for cards only; other
  methods will reject the option at create time.
