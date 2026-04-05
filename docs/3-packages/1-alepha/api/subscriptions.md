# Alepha - Api Subscriptions

## Installation

Part of the `alepha` package. Import from `alepha/api/subscriptions`.

```bash
npm install alepha
```

## Overview

Subscription management module — plan-based access control, billing integration,
usage limits, and lifecycle events (trial, renewal, cancellation, suspension).

Depends on `AlephaPayments` for payment processing — register it in your app
alongside this module. Use `SubscriptionConfig` to declare your plans and limits.

