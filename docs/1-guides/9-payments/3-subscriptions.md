# Subscriptions

`alepha/api/subscriptions` is a SaaS-billing layer built on top of `alepha/api/payments`. It owns plans, trials, dunning, proration, and entitlements — the recurring billing logic stays in Alepha rather than being delegated to the PSP. The same subscription code works against any `PaymentProvider`.

```typescript
import { Alepha } from "alepha";
import { AlephaApiPayments } from "alepha/api/payments";
import { AlephaApiSubscriptions } from "alepha/api/subscriptions";
import { AlephaPaymentsStripe } from "@alepha/payments-stripe";

const alepha = Alepha.create()
  .with(AlephaApiPayments)
  .with(AlephaApiSubscriptions)
  .with(AlephaPaymentsStripe);
```

## Architecture

The dependency graph is one-way:

```
subscriptions  →  payments  →  PaymentProvider  ←  payments-stripe / payments-mollie
```

- `SubscriptionJobs` runs cron jobs (billing cycle, trial expiry, dunning retry, grace-period sweep, expiration sweep) that create payment intents through `PaymentService.createIntent`.
- `BillingService` listens to `payments:captured` and `payments:failed` hooks and advances each subscription's lifecycle: trial → active, active → renewed, past_due → recovered, etc.
- `SubscriptionConfig` reads plan definitions and global settings from the parameters store.

The PSP knows nothing about subscriptions; the subscriptions module knows nothing about Stripe or Mollie.

## Defining plans

Plans live in the parameters store, not in code, so they can be edited at runtime:

```typescript
import { ParameterStore } from "alepha/api/parameters";

const params = alepha.inject(ParameterStore);

await params.set("subscriptions.plans", {
  plans: [
    {
      id: "starter",
      name: "Starter",
      available: true,
      pricing: [
        { interval: "monthly", amount: 1900, currency: "EUR" },
        { interval: "yearly",  amount: 19000, currency: "EUR" },
      ],
      features: ["api-access", "basic-analytics"],
      limits: { seats: 5, projects: 10 },
      trial: { days: 14 },
    },
    {
      id: "pro",
      name: "Pro",
      available: true,
      pricing: [
        { interval: "monthly", amount: 4900, currency: "EUR" },
        { interval: "yearly",  amount: 49000, currency: "EUR" },
      ],
      features: ["api-access", "basic-analytics", "advanced-analytics", "sso"],
      limits: { seats: -1, projects: -1 }, // -1 = unlimited
    },
  ],
});
```

Global settings (trial defaults, dunning schedule, grace period) live under `subscriptions.settings`:

```typescript
await params.set("subscriptions.settings", {
  trialDays: 14,
  gracePeriodDays: 7,
  dunningSchedule: [1, 3, 5, 7], // retry days after first failure
  cancelAtPeriodEnd: true,
  prorateOnChange: true,
});
```

## Subscribing

Subscriptions are scoped to organizations (`user.organization`). The built-in `SubscriptionController` exposes the user-facing actions:

| Endpoint | Purpose |
|---|---|
| `GET /api/subscriptions/plans` | List available plans. |
| `GET /api/subscriptions/mine` | Current org's subscription. |
| `POST /api/subscriptions` | Create a new subscription. |
| `POST /api/subscriptions/mine/change-plan` | Upgrade or downgrade. |
| `POST /api/subscriptions/mine/cancel` | Cancel (immediate or at period end). |
| `POST /api/subscriptions/mine/resume` | Resume a cancelled subscription before it ends. |
| `GET /api/subscriptions/mine/history` | Event log. |
| `GET /api/subscriptions/mine/entitlements` | Features + limits snapshot. |

Programmatic use:

```typescript
import { SubscriptionService } from "alepha/api/subscriptions";

const subs = $inject(SubscriptionService);

const sub = await subs.subscribe(orgId, "pro", "monthly", { trialDays: 7 });
// → status: "trialing", trialEnd: now + 7d, nextBillingAt: trialEnd
```

When the trial ends, `SubscriptionJobs.billingCycle` (cron hourly) creates a payment intent. The user pays via the standard checkout flow. `payments:captured` fires, `BillingService.activate()` flips the status to `active` and sets the next billing period.

## Entitlements

Use entitlements to gate features at the API layer:

```typescript
import { $requirePlan, $requireLimit } from "alepha/api/subscriptions";

class ProjectController {
  create = $action({
    method: "POST",
    path: "/projects",
    use: [
      $secure(),
      $requirePlan({ feature: "advanced-analytics" }),
      $requireLimit({ resource: "projects" }),
    ],
    schema: { /* ... */ },
    handler: async () => { /* ... */ },
  });
}
```

Or check imperatively:

```typescript
const canExport = await subs.can(orgId, "advanced-analytics");
const seatLimit = await subs.limit(orgId, "seats"); // -1 = unlimited, 0 = no access
const ent = await subs.getEntitlements(orgId);
```

## Lifecycle hooks

Subscriptions emit their own hooks that other modules listen to:

```typescript
"subscription:created" | "subscription:activated" | "subscription:renewed"
"subscription:cancelled" | "subscription:expired" | "subscription:resumed"
"subscription:plan_changed" | "subscription:payment_failed"
"subscription:suspended" | "subscription:reactivated" | "subscription:trial_ending"
```

Wire your notifications and audit log here, not in the controllers:

```typescript
import { $hook } from "alepha";

class BillingNotifications {
  protected readonly onActivated = $hook({
    on: "subscription:activated",
    handler: async (event) => {
      await this.emails.send("subscription-activated", {
        organizationId: event.organizationId,
        planId: event.planId,
      });
    },
  });
}
```

## Dunning and grace period

When a renewal payment fails:

1. `BillingService.handlePaymentFailure` flips the subscription to `past_due` and starts dunning.
2. `SubscriptionJobs.dunningRetry` (cron hourly) creates a new payment intent on each scheduled retry day (default `[1, 3, 5, 7]`).
3. If a retry succeeds, `BillingService.recoverFromDunning` clears state and returns the subscription to `active`.
4. If the grace period (default 7 days from the first failure) elapses without recovery, `SubscriptionJobs.gracePeriodSweep` (daily) flips the subscription to `suspended`.
5. Suspended subscriptions can be revived by an admin or by a successful payment from the customer.

Throughout this flow, `isAccessible(sub)` returns `true` for `trialing | active | past_due` (so the customer keeps access during dunning). Suspended and expired subscriptions return `false`.

## Why Alepha-side and not native PSP subscriptions?

The trade-off is deliberate:

- **Alepha-side** (current design): one set of plans/lifecycle/dunning across every PSP. Clean dependency graph. Plans live in your parameters store, not Stripe's dashboard. Migration between PSPs is a config change.
- **Native PSP subscriptions**: invoice PDFs, smart retry timing, customer portals out of the box — but plans are duplicated (Stripe has its own products/prices), the lifecycle is split between two systems, and switching providers is a project.

For SaaS apps that want full control over billing logic, the Alepha-side approach is the right default.
