# Alepha - Api Workflows

## Installation

```bash
npm install alepha
```

## Overview

Provides durable workflow orchestration for Alepha applications.

This module includes:
- $workflow and $activity descriptors
- Workflow execution engine
- Signal-based event handling
- HTTP API for workflow management

Features:
- Event-sourced execution for complete auditability
- Fault tolerance with automatic recovery
- Saga pattern for compensation and rollback
- Human-in-the-loop support
- Type-safe workflow and activity definitions

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

#### $activity()

Define a workflow activity that encapsulates side effects.

Activities are the unit of work that:
- Execute side effects (API calls, database writes, file operations)
- Can be retried on failure
- Have their own timeout and heartbeat configuration
- Are idempotent (safe to execute multiple times)

```typescript
class OrderActivities {
  paymentGateway = $inject(PaymentGateway);

  chargePayment = $activity({
    name: "charge-payment",
    schema: t.object({
      orderId: t.uuid(),
      customerId: t.uuid(),
      amount: t.number(),
    }),
    timeout: { seconds: 30 },
    retryPolicy: {
      maxAttempts: 3,
      backoff: "exponential",
    },
    handler: async ({ orderId, customerId, amount }, ctx) => {
      const payment = await this.paymentGateway.charge({
        customer: customerId,
        amount,
        metadata: { orderId },
      });
      await ctx.heartbeat();
      return { id: payment.id, confirmationId: payment.confirmation };
    },
  });
}
```

#### $workflow()

Define a durable workflow that orchestrates activities and manages state across failures.

Workflows are deterministic orchestrations that:
- Survive process restarts and failures
- Maintain state through event sourcing
- Support compensation/rollback (saga pattern)
- Can run for days, weeks, or months
- Handle human-in-the-loop operations

```typescript
class OrderWorkflows {
  activities = $inject(OrderActivities);

  fulfillment = $workflow({
    name: "order-fulfillment",
    schema: t.object({
      orderId: t.uuid(),
      customerId: t.uuid(),
    }),
    handler: async ({ orderId, customerId }, ctx) => {
      const reservation = await ctx.activity(this.activities.reserveInventory, { orderId });
      const payment = await ctx.activity(this.activities.chargePayment, { orderId, customerId });
      await ctx.activity(this.activities.shipOrder, { orderId });
      return { status: "fulfilled", paymentId: payment.id };
    },
  });
}
```
