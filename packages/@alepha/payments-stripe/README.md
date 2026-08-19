# Alepha @alepha/payments Stripe

Stripe payment provider for alepha/payments.

## Installation

Part of the Alepha framework, published on its own:

```bash
npm install @alepha/payments-stripe
```

## Module

Stripe backend for `alepha/api/payments`. Registering the module replaces
the default `MemoryPaymentProvider` with `StripePaymentProvider`: Checkout
sessions, embedded Payment Element sessions, capture/void/refund, saved
payment methods, signed webhooks (async verification, workerd-safe) and
Connect-style platform fees.

Environment: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and for the
Payment Element `STRIPE_PUBLISHABLE_KEY`; `STRIPE_CONNECT_WEBHOOK_SECRET`
gates Connect webhooks.

## API Reference

### Environment Variables

Environment variables used to configure this package.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `STRIPE_CONNECT_WEBHOOK_SECRET` | string | - |  |
| `STRIPE_PUBLISHABLE_KEY` | string | - |  |
| `STRIPE_SECRET_KEY` | string | **Required** |  |
| `STRIPE_WEBHOOK_SECRET` | string | **Required** |  |
