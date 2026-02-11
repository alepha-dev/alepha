# `$workflow` Primitive — Specification


## 1. Overview

`$workflow` is a durable workflow primitive for Alepha. It enables long-running, multi-step processes that survive crashes, restarts, and deployments. Built entirely on top of `$job` v2.

A workflow is a function that runs step-by-step. Each step is a durable checkpoint — its result is persisted to the database. On crash or restart, the workflow replays from the beginning, but completed steps return their cached results without re-executing.

### 1.1 Design Principles

- **Durable by default.** Every step result is persisted. Crashes between steps never lose work.
- **Code-first.** Write workflows as regular TypeScript async functions. No YAML, no state machines, no DAGs.
- **Built on $job.** Workflows use `$job` v2 for dispatch, retry, scheduling, and queue management. No parallel infrastructure.
- **Step-at-a-time.** Each step is a separate invocation of the workflow handler. No long-running workers.
- **Versionable.** Multiple handler implementations can coexist — old runs continue with the version they started on, new runs use the latest version. Safe deploys without draining.
- **DI-native.** Full access to Alepha's dependency injection via `$inject`.
- **Convention-driven.** Declared as class properties, auto-registered. Same patterns as `$job`.

### 1.2 What It Replaces

Without `$workflow`, users chain jobs manually:

```ts
// Before: manual chaining, no durability between steps
await this.chargeJob.push({ orderId })
// In chargeJob handler:
await this.shipJob.push({ orderId, paymentId })
// In shipJob handler:
await this.notifyJob.push({ orderId, trackingId })
```

Problems: no unified state, no compensation, no visibility into the overall process, no saga rollback.

With `$workflow`:

```ts
handler: async ({ input, step }) => {
  const payment = await step.run("charge", () => this.payments.charge(input.orderId))
  const tracking = await step.run("ship", () => this.shipping.ship(input.orderId))
  await step.run("notify", () => this.notifications.send({
    paymentId: payment.id,
    trackingId: tracking.id,
  }))
}
```

### 1.3 How $job v2 Enables This

`$job` v2 provides everything the workflow engine needs at the execution layer:

| $job v2 Feature | Workflow Use |
| --- | --- |
| Transactional persistence | Every workflow start and step result is DB-persisted before dispatch |
| Retry with backoff | Step-level retry — each step can fail and retry independently |
| Delayed scheduling (`scheduledAt`) | `step.sleep()` and `step.sleepUntil()` — schedule re-invocation |
| Queue dispatch | Each workflow invocation is dispatched through the job queue |
| Concurrency control | Limit parallel workflow executions per definition |
| Cron triggers | Cron-triggered workflows (ETL pipelines, reconciliation) |
| Priority | Workflow priority flows through to job dispatch |
| Admin UI & observability | Workflow executions visible in the jobs admin |
| Graceful shutdown | In-flight workflow steps respect shutdown signals |

The workflow layer adds: step memoization, compensation (saga), signals, child workflows, versioning, and heartbeat-based crash recovery.

---

## 2. API

### 2.1 Workflow Definition

`$workflow` is a **class property**. The primitive captures `this` from the owning class during `onInit()`, so the handler has access to all sibling `$inject` / `$logger` / `$repository` properties.

```ts
import { $workflow } from "alepha/api/workflows"
import { $inject, $logger, t } from "alepha"

class OrderWorkflows {
  protected readonly orders = $inject(OrderService)
  protected readonly payments = $inject(PaymentService)
  protected readonly shipping = $inject(ShippingService)
  protected readonly log = $logger()

  processOrder = $workflow({
    // --- Input schema (TypeBox) ---
    schema: t.object({
      orderId: t.uuid(),
      userId: t.uuid(),
    }),

    // --- Output schema (optional, TypeBox) ---
    outputSchema: t.object({                   // validates handler return value before persisting
      trackingId: t.text(),
      invoiceId: t.text(),
    }),

    // --- Version (optional) ---
    version: "1.0.0",                          // semantic version for safe deploys (see section 4.8)

    // --- Timeout (optional) ---
    timeout: [1, "hour"],                      // max total workflow duration
    stepTimeout: [5, "minute"],                // default timeout per step

    // --- Step retry policy (optional, default for all steps) ---
    retry: {
      retries: 3,
      backoff: { initial: [5, "second"], factor: 2, max: [5, "minute"] },
    },

    // --- Concurrency (optional) ---
    concurrency: 5,                            // max workflows in active states (running/waiting/sleeping)

    // --- Priority (optional) ---
    priority: "normal",

    // --- Handler ---
    handler: async ({ input, step, workflowId, signal }) => {
      // Step 1: Validate
      const order = await step.run("validate", async () => {
        return this.orders.getById(input.orderId)
      })

      // Step 2: Charge (with saga compensation)
      const payment = await step.run("charge", {
        run: async () => this.payments.charge(order),
        rollback: async (result) => this.payments.refund(result.paymentId),
      })

      // Step 3: Wait for external signal
      const confirmation = await step.waitFor("warehouse-confirm", {
        timeout: [4, "hour"],
      })

      // Step 4: Parallel execution using Promise.all
      const [tracking, invoice] = await Promise.all([
        step.run("ship", () => this.shipping.ship(order, confirmation)),
        step.run("invoice", () => this.billing.createInvoice(order, payment)),
      ])

      // Step 5: Notify
      await step.run("notify", async () => {
        await this.notifications.send(input.userId, {
          trackingId: tracking.id,
          invoiceId: invoice.id,
        })
      })

      // Return value is persisted as workflow output
      return { trackingId: tracking.id, invoiceId: invoice.id }
    },
  })
}
```

### 2.2 Step Primitives

The `step` object provides four durable primitives. Each call is a checkpoint — on replay, completed steps return cached results without re-executing. Parallel execution uses native `Promise.all` — no special primitive needed.

#### `step.run(id, handler)` — Durable Step

Execute a function and persist its result. On replay, returns the cached result.

```ts
// Simple form
const result = await step.run("step-id", async () => {
  return someWork()
})

// Simple form with options
const result = await step.run("step-id", async () => {
  return someWork()
}, {
  schema: t.object({ id: t.uuid(), total: t.number() }), // validate return value
  timeout: [2, "minute"],                     // override default step timeout
  retry: { retries: 2, backoff: [5, "second"] }, // override default retry
})

// With compensation (saga pattern)
const result = await step.run("step-id", {
  run: async () => someWork(),
  rollback: async (result) => undoWork(result),
  schema: t.object({ id: t.uuid() }),          // validate return value
  timeout: [2, "minute"],
  retry: { retries: 2, backoff: [5, "second"] },
})
```

**Three call signatures:**
1. `step.run(id, fn)` — minimal, no options
2. `step.run(id, fn, options)` — function with options (`schema`, `timeout`, `retry`)
3. `step.run(id, { run, rollback, ...options })` — saga pattern with compensation

When `schema` is provided, the return value is validated against it before persistence. A `WorkflowSerializationError` is thrown if validation fails (see section 4.1).

**Step IDs must be unique within a workflow.** The ID is the memoization key. Using the same ID twice throws an error at runtime.

**Step IDs are rename-sensitive.** Renaming a step ID is a breaking change for in-flight workflows — the renamed step won't find its cached result and will re-execute. Use versioning (section 4.8) when renaming step IDs in workflows that may have active executions.

#### `step.sleep(id, duration)` — Durable Sleep

Pause the workflow for a duration. No worker is consumed during sleep.

```ts
await step.sleep("cool-down", [5, "minute"])
await step.sleep("wait-24h", [24, "hour"])
```

Internally, `step.sleep` inserts a `workflow_steps` record with `status: "completed"` immediately — the sleep *is* the step, and its "result" is `null`. The delay is handled by scheduling the next `$job` invocation via `scheduledAt`. On replay, `step.sleep` finds the cached record and returns immediately (no re-sleeping).

#### `step.sleepUntil(id, datetime)` — Durable Sleep Until

Pause until a specific datetime.

```ts
await step.sleepUntil("market-open", new Date("2026-03-15T09:30:00Z"))
```

#### `step.waitFor(id, options?)` — Wait for External Signal

Pause the workflow until an external signal is received.

```ts
const signal = await step.waitFor("approval", {
  timeout: [24, "hour"],                      // optional: fail if not received
})
// signal.data contains the payload sent by the signal sender
```

If timeout expires without a signal, the step throws a `WorkflowTimeoutError`. Signals that arrive *before* the workflow reaches `waitFor` are buffered and returned immediately when the handler catches up.

**`step.waitFor` in `Promise.all`.** `waitFor` follows the same sentinel pattern as `step.run`:

```ts
const [signal, data] = await Promise.all([
  step.waitFor("approval"),
  step.run("fetch-data", () => this.getData()),
])
```

Both calls return sentinels. In Phase 2, the framework sees 1 pending step + 1 pending signal. It executes the step, persists its result, registers the signal listener in `workflow_signals`, and suspends (status → `waiting`). When the signal arrives, re-dispatch resumes: `waitFor` returns cached signal data, `step.run` returns cached step result, `Promise.all` resolves.

#### Parallel Execution — `Promise.all` with `step.run`

No special primitive needed. Use native `Promise.all` with multiple `step.run` calls. Each step is independently memoized — on replay, completed steps return cached results while new ones execute.

```ts
const [user, subscription, settings] = await Promise.all([
  step.run("fetch-user", async () => {
    return this.users.getById(input.userId)
  }),
  step.run("fetch-subscription", async () => {
    return this.billing.getSubscription(input.subId)
  }),
  step.run("fetch-settings", async () => {
    return this.settings.getForUser(input.userId)
  }),
])
```

**How it works.** When the framework encounters multiple `step.run` calls via `Promise.all`:

1. Each `step.run` checks the memoization map independently.
2. Cached steps return their result immediately (resolved promise).
3. Uncompleted steps are all dispatched concurrently within the same invocation.
4. All new steps execute in parallel. On completion, results are persisted.
5. The handler continues with all results.

**Failure semantics.** If any parallel step fails, other steps that already started continue. The failed step's retry policy applies independently. If a step exhausts retries, `Promise.all` rejects and the workflow enters failure/compensation.

This is the same pattern as OpenWorkflow — `Promise.all` is the natural parallel primitive. No framework-specific API to learn.

#### `step.invoke(id, workflow, input, options?)` — Child Workflow

Start a child workflow and wait for its completion.

```ts
const result = await step.invoke("process-payment", this.paymentWorkflow, {
  orderId: order.id,
  amount: order.total,
})
```

Child workflows are independent executions with `parentId` linking them to the parent. By default, cancelling the parent cascades to the child.

**Detached children.** Use `{ detached: true }` to prevent cancellation cascade. Detached children run to completion independently — the parent still waits for the result, but cancelling the parent does not cancel the child:

```ts
const result = await step.invoke("critical-cleanup", this.cleanupWorkflow, input, {
  detached: true,
})
```

Use `detached` when the child performs critical work (compensation, cleanup) that must complete even if the parent is cancelled, or when the child workflow is shared across multiple parents.

#### Future: `step.emit(id, fn)` — Fire-and-Forget (not in v1)

A lightweight non-durable step for side effects that don't need retry or compensation (analytics, metrics, audit logs). Executes the function but doesn't persist the result or add an invocation cycle. Logs a warning on failure. Not included in v1 — use `step.run` for now. Tracked for a future release when usage patterns are clearer.

#### Code Between Steps — Replay Warning

**Any code between `step.*` calls executes on every invocation.** The handler is re-invoked from the top on each step. Cached steps return instantly, but non-step code still runs:

```ts
handler: async ({ input, step }) => {
  const order = await step.run("validate", () => this.orders.get(input.orderId))

  // SAFE: logging and pure data transforms — harmless on replay
  this.log.info("Order validated", { orderId: order.id })
  const total = order.items.reduce((sum, i) => sum + i.price, 0)

  // DANGEROUS: side effect outside a step — runs on EVERY invocation
  await this.metrics.increment("orders.validated")  // ← fires N times, not 1

  await step.run("charge", () => this.payments.charge(order))
}
```

For a 6-step workflow, `metrics.increment` fires 6 times (once per invocation) instead of 1. **Move all side effects into `step.run()`:**

```ts
// Good: side effect inside a step — runs exactly once
await step.run("track-validated", () => this.metrics.increment("orders.validated"))
await step.run("charge", () => this.payments.charge(order))
```

**Rule of thumb:** Code between steps must be **pure** — logging, local variable assignments, conditionals on cached step results. Anything that calls an external service, writes to a database, sends a message, or increments a counter belongs inside `step.run()`.

### 2.3 Starting Workflows

`.start()` takes input (validated against schema) and optional options.

```ts
// Start a workflow
const { workflowId } = await this.processOrder.start({
  orderId: "abc-123",
  userId: "xyz-789",
})

// Start with options
const { workflowId } = await this.processOrder.start(
  { orderId: "abc-123", userId: "xyz-789" },
  {
    key: "order_abc-123",                     // uniqueness constraint (same as $job)
    priority: "high",                         // override definition-level default
  },
)
```

### 2.4 Awaiting a Workflow Result

`.waitFor()` blocks until the workflow completes (or fails/cancels) and returns the output:

```ts
// Start and await result (short-lived workflows)
const { workflowId } = await this.processOrder.start(input)
const result = await this.processOrder.waitFor(workflowId, {
  timeout: [30, "second"],
})
// result = { trackingId: "...", invoiceId: "..." }

// In an HTTP handler — start workflow and return result synchronously
handleOrder = $action({
  method: "POST",
  path: "/orders",
  handler: async ({ body }) => {
    const { workflowId } = await this.processOrder.start(body)
    return this.processOrder.waitFor(workflowId, { timeout: [30, "second"] })
  },
})
```

Internally, `waitFor` subscribes to the `workflow:complete`, `workflow:fail`, and `workflow:cancel` events for the given `workflowId`. If the workflow is already in a terminal state when `waitFor` is called, it returns immediately. If the timeout expires, it throws `WorkflowTimeoutError`.

For long-running workflows, use events or webhooks instead of `waitFor`:

```ts
alepha.on("workflow:complete", ({ workflowId, output }) => {
  // Notify caller via webhook, WebSocket, etc.
})
```

### 2.5 Sending Signals

External code sends signals to a waiting workflow.

```ts
// Send a signal to a workflow
await this.processOrder.signal(workflowId, "warehouse-confirm", {
  warehouseId: "wh-01",
  estimatedShipDate: "2026-02-15",
})

// From an HTTP handler (webhook)
class WebhookController {
  protected readonly workflows = $inject(WorkflowProvider)

  handleWarehouseWebhook = $action({
    method: "POST",
    path: "/webhooks/warehouse",
    handler: async ({ body }) => {
      await this.workflows.signal(body.workflowId, "warehouse-confirm", {
        warehouseId: body.warehouseId,
        estimatedShipDate: body.shipDate,
      })
    },
  })
}
```

### 2.6 Cancellation

```ts
await this.processOrder.cancel(workflowId)
```

When cancelled:

1. If a step is currently running, its `AbortSignal` is triggered.
2. Compensation handlers run in **reverse order** for all completed steps that have `rollback` defined.
3. Child workflows are cancelled recursively.
4. Status transitions to `cancelled`.

The cancelling user is tracked via the user atom:

```ts
// cancelledBy and cancelledByName are populated from the current user atom
```

### 2.7 Cron-Triggered Workflows

Workflows can self-trigger on a schedule, just like `$job` cron:

```ts
monthlyReconciliation = $workflow({
  cron: "0 2 1 * *",                          // 1st of every month at 02:00
  lock: true,

  handler: async ({ step }) => {
    const accounts = await step.run("fetch", () => this.accounts.getAll())
    for (const account of accounts) {
      await step.run(`reconcile-${account.id}`, () => this.reconcile(account))
    }
  },
})
```

Cron workflows create execution records on each tick, same as `$job` cron.

### 2.8 Transactional Start

Start a workflow atomically within a database transaction.

```ts
class OrderService {
  protected readonly orders = $repository(orderEntity)
  protected readonly processOrder = $inject(OrderWorkflows).processOrder

  createOrder = $transaction({
    handler: async (tx, data: CreateOrderInput) => {
      const order = await this.orders.create(data, { tx })
      await this.processOrder.start(
        { orderId: order.id, userId: data.userId },
        { tx },
      )
      return order
    },
  })
}
```

### 2.9 Manual Trigger (Admin / CLI)

```ts
// HTTP — POST /api/workflows/trigger
// { "name": "OrderWorkflows.processOrder", "input": { "orderId": "abc" } }

// CLI — alepha workflows trigger OrderWorkflows.processOrder --input '{"orderId":"abc"}'
```

Input is validated against the workflow's `schema` before dispatch. If validation fails, the trigger returns a 422 error with the validation details. The admin UI can use the schema to render a form with appropriate input fields.

---

## 3. Architecture

### 3.1 Execution Model: Step-at-a-Time

The workflow handler is **not** a long-running function. It is re-invoked for each step. This is the Inngest model, not the Temporal coroutine model.

The handler uses a **two-phase execution model**: plan, then execute.

**Phase 1 — Plan.** The handler runs. Each `step.run(id, fn)` call checks the memoization map:
- **Cached** → returns a resolved promise with the stored result. Handler continues.
- **New** → registers the step as "pending" and returns a **sentinel promise** that never resolves in this invocation.

When the handler awaits a sentinel (sequential step) or `Promise.all` with sentinels (parallel steps), it stalls.

**Stall detection — two-pass approach.** The framework does not rely on timers (`setTimeout`, `queueMicrotask`) to detect stalls. Timer-based approaches have subtle ordering differences across runtimes (Node.js, Bun, workerd/Cloudflare Workers). Instead, the framework uses a deterministic two-pass approach:

```ts
// Phase 1 — Plan: run handler, collect sentinels
const stepContext = createStepContext(memoMap) // step.run/waitFor register here
let output: unknown

try {
  output = await handler({ input, step: stepContext, workflowId, signal })
} catch (err) {
  // Handler threw a real error (not a stall — sentinels never throw)
  throw err
}

// If we reach here, the handler completed without stalling.
// This means every step.run returned a cached result (all resolved promises).
if (stepContext.pendingSteps.length === 0 && stepContext.pendingSignals.length === 0) {
  // All steps cached → workflow is done
  await persistOutput(output)
  return
}

// Unreachable: if pending steps exist, the handler would be stalled on
// sentinel promises and `await handler(...)` would never resolve.
```

The key insight is that `await handler(...)` only returns if the handler runs to completion — meaning every step was cached and returned a resolved promise. If **any** `step.run` returns a sentinel (never-resolving promise), the handler stalls on `await sentinel` and the outer `await handler(...)` hangs indefinitely.

This means the framework needs a way to **not** await the handler when sentinels are in play. The solution: the step context tracks whether any sentinel was issued. The framework wraps the handler with a race against a **sentinel-triggered** promise:

```ts
const stallPromise = stepContext.onStall() // resolves when first sentinel is awaited

const result = await Promise.race([
  handler(ctx).then((output) => ({ done: true as const, output })),
  stallPromise.then(() => ({ done: false as const })),
])

if (result.done) {
  await persistOutput(result.output)
} else {
  // Phase 2: pending steps/signals collected by stepContext
  await executePhase2(stepContext)
}
```

**How `onStall()` works — implementation note.** The sentinel is a custom thenable (implements `.then()`). When `Promise.all` or `await` subscribes to the sentinel via `.then()`, the override records the subscription and schedules `notifyStall()` via `Promise.resolve().then(() => notifyStall())` — a microtask guaranteed by the Promise/A+ spec to fire after the current synchronous execution completes. This is portable across all JavaScript runtimes (Node.js, Bun, workerd), unlike `setTimeout(0)` which has runtime-dependent scheduling.

For `Promise.all` with multiple sentinels: `Promise.all` calls `.then()` on each sentinel synchronously. Each override schedules a microtask. The first microtask to fire calls `notifyStall()`, resolving `stallPromise`. By this point, all parallel steps are already registered (`.then()` was called on all of them synchronously before any microtask fired). This is fully deterministic across all JavaScript runtimes — no dependency on timer scheduling semantics.

**Phase 2 — Execute.** The framework collects all pending steps and pending signals from the step context. Steps are executed in parallel (up to `maxParallelSteps` — see section 8.1), results are persisted **individually** to `workflow_steps` as each completes (not batched — see section 4.5). Pending signal listeners are registered in `workflow_signals`. Then the handler is re-dispatched via `$job`. The stalled handler is discarded (no cleanup needed — it never produced side effects beyond step registrations).

This is the key insight: `step.run` does **not** throw. It returns a promise. For cached steps, the promise is already resolved. For new steps, the promise is a sentinel that never resolves. This means `Promise.all` naturally collects all parallel new steps before any of them need to resolve — enabling true parallel execution without a special primitive.

```
Invocation 1:
  step.run("validate") → NEW → sentinel (handler stalls)
  Framework: 1 pending step → execute "validate" → persist → re-dispatch

Invocation 2:
  step.run("validate") → CACHED → resolved
  step.run("charge")   → NEW → sentinel (handler stalls)
  Framework: 1 pending step → execute "charge" → persist → re-dispatch

Invocation 3:
  step.run("validate") → CACHED
  step.run("charge")   → CACHED
  step.waitFor("approval") → NEW → register signal listener → suspend
  Framework: 0 pending steps, 1 signal registered → wait

  ── signal "approval" received → re-dispatch ──

Invocation 4:
  step.run("validate") → CACHED
  step.run("charge")   → CACHED
  step.waitFor("approval") → CACHED → resolved with signal data
  Promise.all([
    step.run("ship")    → NEW → sentinel
    step.run("invoice") → NEW → sentinel
  ]) → handler stalls on Promise.all (both sentinels registered)
  Framework: 2 pending steps → execute both in parallel → persist → re-dispatch

Invocation 5:
  step.run("validate") → CACHED
  step.run("charge")   → CACHED
  step.waitFor("approval") → CACHED
  Promise.all([
    step.run("ship")    → CACHED → resolved
    step.run("invoice") → CACHED → resolved
  ]) → Promise.all resolves instantly
  step.run("notify")   → NEW → sentinel (handler stalls)
  Framework: 1 pending step → execute "notify" → persist → re-dispatch

Invocation 6:
  All steps → CACHED → resolved
  Handler returns → WORKFLOW COMPLETE
```

Each invocation is a separate `$job` execution. No worker is blocked between steps. Replay overhead is minimal — cached steps are resolved promises from pre-loaded in-memory map lookups.

### 3.2 How It Builds on $job v2

| Concern | Built On | Notes |
| --- | --- | --- |
| Dispatch & scheduling | `$job` internal job per workflow def | Each invocation is a job execution |
| Step execution | Inline within job handler | Steps run inside the job handler invocation |
| Step memoization | `workflow_steps` entity | Keyed by workflow ID + step ID |
| Parallel execution | Native `Promise.all` + `step.run` | Each step independently memoized, no special primitive |
| Signals | `workflow_signals` entity + re-dispatch | Signal arrival triggers job dispatch |
| Sleep / delay | `$job` `scheduledAt` | Delayed re-invocation via job scheduling |
| Retry (step-level) | DB-level rescheduling | Same mechanism as `$job` retry |
| Compensation (saga) | Reverse-order rollback steps | Each rollback is itself a persisted step |
| Concurrency | Workflow-layer count check at `start()` | Logical workflow concurrency (active instance count) |
| Cron triggers | `CronProvider` via `$job` | Same cron mechanism as `$job` |
| Crash recovery | Heartbeat + `$job` recovery sweep | Heartbeat for fast detection, sweep as fallback |
| Versioning | `version` field on definition + execution | Old runs keep old handler, new runs get new handler |
| Observability | `workflow_executions` + admin endpoints | Dedicated admin UI for workflow state |
| Internal job isolation | `internal: true` flag on workflow jobs | Filtered from jobs admin by default (toggle to show) |

### 3.3 Internal Dispatch Flow

```
                  ┌──────────────────────────────────────────┐
                  │  $workflow.start(input)                   │
                  └─────────────────┬────────────────────────┘
                                    │
                  ┌─────────────────v────────────────────────┐
                  │  INSERT workflow_executions               │
                  │  status: "running"                        │
                  └─────────────────┬────────────────────────┘
                                    │
                  ┌─────────────────v────────────────────────┐
                  │  $job.push (internal workflow job)        │
                  │  payload: { workflowId }                  │
                  └─────────────────┬────────────────────────┘
                                    │
              ┌─────────────────────v──────────────────────┐
              │  Job handler (invocation N)                  │
              │                                              │
              │  1. Load workflow execution (incl. version)   │
              │  2. Resolve handler for this version          │
              │  3. Load all workflow_steps for workflowId   │
              │  4. Extend heartbeat timestamp                │
              │  5. Run handler with step context             │
              │  6. On stall (pending steps detected):        │
              │     - Execute all pending steps in parallel   │
              │     - Persist step results                    │
              │     - Re-dispatch job (invocation N+1)        │
              │  7. On handler return:                        │
              │     - Mark workflow completed                 │
              │     - Persist output                          │
              └──────────────────────────────────────────────┘
```

### 3.4 Compensation (Saga Pattern)

When a step fails (after exhausting retries) or the workflow is cancelled, the workflow transitions to `compensating` status and compensation runs in **reverse registration order**:

```
Steps completed:   validate → charge → ship (FAILED)
                   (no rollback)  (has rollback)

Compensation sequence:
  1. charge.rollback(chargeResult) → refund payment
  (validate has no rollback — skipped)
```

**Rollback order is reverse registration order** — the order `step.run` calls were made in the handler source code, tracked by a monotonic counter on the step context. This is deterministic regardless of completion time. For parallel steps in `Promise.all`, registration order is the order the `step.run` calls appear in the array (since they execute synchronously during Phase 1):

```ts
await Promise.all([
  step.run("A", { run: ..., rollback: ... }),  // registered first
  step.run("B", { run: ..., rollback: ... }),  // registered second
])
// If both completed and later step fails:
// Rollback order: B.rollback() → A.rollback()
```

**Compensation always runs sequentially**, even for steps that originally executed in parallel. This is predictable and avoids interactions between concurrent rollback handlers (e.g., two refunds racing on the same account). Order is determined by `workflow_steps.ordinal DESC` — the monotonic counter set when `step.run` is called, not when the step completes.

Compensation handlers are themselves durable — persisted as steps with `_rollback:` prefix. If a compensation handler fails, it is retried according to the workflow's `compensationRetries` config. If exhausted, the workflow transitions to `compensation_failed` status for manual intervention (retryable via admin action — see section 9.2).

### 3.5 Heartbeat & Crash Recovery

Workflows use a **heartbeat mechanism** for fast crash detection, with the `$job` recovery sweep as a fallback.

**Heartbeat protocol:**

1. When a workflow invocation starts, the worker sets `heartbeatAt` on the `workflow_executions` record to `now + heartbeatInterval`.
2. During execution, the worker periodically extends `heartbeatAt` (every `heartbeatInterval`, default: 30 seconds).
3. If the worker crashes, the heartbeat stops extending.
4. The heartbeat sweep (internal system job, every `heartbeatInterval`) scans for workflows where `status IN ('running', 'compensating')` and `heartbeatAt < now`. These are assumed crashed.
5. Crashed workflows are re-dispatched via `$job` — the next invocation replays cached steps and re-attempts the interrupted step.

This gives **sub-minute crash detection** vs the `$job` recovery sweep's 60-second poll. The `$job` sweep remains as a safety net for edge cases (e.g., both heartbeat and worker fail simultaneously).

**No corruption possible.** The workflow step either completed (result persisted to `workflow_steps`) or didn't (will re-execute on the next invocation). The heartbeat mechanism never modifies step state — it only triggers re-dispatch.

### 3.6 Graceful Shutdown

On `SIGTERM` / `SIGINT`:

1. The `$job` layer stops claiming new invocations.
2. In-flight step executions are given time to complete (via `$job` grace period).
3. The worker stops extending heartbeats. If the step completes within the grace period, the workflow persists its state normally.
4. If a step doesn't finish, the heartbeat expires and another worker picks up the workflow.

### 3.7 Step Persistence Lifecycle

Step records use an **insert-before-execute** model. A row is created with `status: "running"` before the step function executes, and updated to `completed` or `failed` after.

```
Phase 2 begins → for each pending step:
  1. INSERT workflow_steps { stepId, status: "running", ordinal, ... }
  2. Execute step function
  3a. Success → UPDATE status = "completed", result = <serialized return value>
  3b. Failure → UPDATE status = "failed", error = <message + stack>
```

**Status transitions:**

- `running` → `completed` — step function returned successfully.
- `running` → `failed` — step function threw (after step-level retries, `attempt` is incremented and step re-executes from `running`).
- `completed` → `rolled_back` — compensation ran for this step.

**On re-invocation (memoization):**

- `completed` → return cached `result` (resolved promise).
- `failed` with retries remaining → re-execute (update `attempt`, execute again).
- `failed` with retries exhausted → trigger compensation.
- `rolled_back` → re-execute. The compensation undid the side effect, so the step must run again. This is relevant during admin "Retry" — see below.
- `running` → stale from a crash. Re-execute the step function (the `running` row is evidence the previous attempt didn't complete). This is why step functions must be idempotent (see section 4.10).

**Why insert-before-execute?** Two reasons:

1. **Admin visibility.** The admin UI can show which steps are currently `running` — not just which are completed. Without this, in-progress steps during Phase 2 would be invisible to operators.
2. **Child workflow idempotency.** `step.invoke` inserts a `running` row with the child's `workflowId` before starting the child. On crash and re-invocation, the `running` row prevents starting a duplicate child (see section 4.6).

**Parallel step persistence.** During Phase 2, each step's INSERT and UPDATE are independent. If step A completes but the worker crashes before step B finishes, A's row is `completed` and B's row is `running`. On re-invocation, A is cached and B re-executes. See section 4.5.

---

## 4. Behaviors

### 4.1 Step Memoization (Two-Phase Model)

Step results are keyed by step ID (`string`). Each invocation runs in two phases:

**Phase 1 — Plan.** Load all `workflow_steps` rows for this workflow into an in-memory map. Run the handler. When `step.run(id, fn)` is called:
- If `id` exists with `status: "completed"` → return a **resolved promise** with the cached result. Handler continues normally.
- If `id` exists with `status: "running"` → stale from a crash. Treat as new (re-execute).
- If `id` exists with `status: "failed"` and retries remain → treat as new (re-attempt).
- If `id` does NOT exist → register `fn` as a **pending step** and return a **sentinel promise** (a promise that never resolves in this invocation).

The handler stalls when it `await`s a sentinel. For sequential steps, this happens immediately. For `Promise.all`, all step.run calls execute synchronously (registering their sentinels) before `Promise.all` awaits — which is why parallel steps are naturally collected.

**Phase 2 — Execute.** After a microtask, the framework detects that the handler is stalled (awaiting sentinels). It collects all pending steps, executes their functions in parallel, persists results to `workflow_steps`, and re-dispatches via `$job`. The current invocation is then discarded (the stalled handler is abandoned — no cleanup needed since it never produced side effects beyond the step registrations).

On the next invocation, the newly completed steps are in the memoization map and return resolved promises. The handler progresses further.

**Why sentinels, not throws?** A thrown `StepExecuted` exception would break `Promise.all` — the first throw rejects the entire group before other parallel steps register. Sentinel promises avoid this: all `step.run` calls in a `Promise.all` register before any of them need to resolve.

**Determinism requirement.** Step IDs must be consistent across replays. The handler may contain conditional logic and loops — this is fine as long as conditions depend on persisted step results (which are deterministic across replays):

```ts
// Good: condition based on persisted step result
const order = await step.run("validate", () => this.orders.get(id))
if (order.requiresApproval) {
  await step.waitFor("approval")
}

// Good: loop with deterministic IDs from persisted data
const items = await step.run("fetch-items", () => this.getItems())
for (const item of items) {
  await step.run(`process-${item.id}`, () => this.process(item))
}

// Bad: non-deterministic — fetchItems() may return different results on replay
const items = await fetchItems()  // NOT a step!
for (const item of items) {
  await step.run(`process-${item.id}`, () => this.process(item))
}

// Bad: non-deterministic ID
await step.run(crypto.randomUUID(), () => ...)
```

**Replay overhead.** Each invocation loads all `workflow_steps` rows into an in-memory map. For workflows with fewer than ~100 steps, this is negligible. For workflows that generate hundreds of dynamic steps (e.g., processing large file sets), prefer splitting into child workflows via `step.invoke()` to keep each workflow's step count manageable.

The framework emits a warning log when step count exceeds `warnStepCount` (default: 100): `"Workflow has ${n} steps (threshold: ${warnStepCount}). Consider splitting into child workflows for better performance."` The `maxInvocations` safety limit (default: 1000) catches runaway cases.

**Serialization.** Step results are persisted as JSONB. Only JSON-serializable values are allowed: plain objects, arrays, strings, numbers, booleans, and `null`. Non-serializable values throw `WorkflowSerializationError` at persist time:

- `Date` → serializes to ISO string, deserializes as `string` (not `Date`). Use `.toISOString()` explicitly and parse on the consumer side.
- `Map`, `Set`, `Buffer`, class instances → throw `WorkflowSerializationError`. Convert to plain objects/arrays first.
- `undefined` → treated as `null` in JSONB.
- Circular references → throw `WorkflowSerializationError`.

**TypeScript return type.** `step.run<T>` returns `JsonSerializable<T>`, not `T`. This mapped type recursively converts `Date` to `string`, strips `Map`/`Set`/class instances, and makes TypeScript honest about what you get from cache:

```ts
// TypeScript error: Property 'getTime' does not exist on type 'string'
const order = await step.run("validate", async () => {
  return { id: "abc", createdAt: new Date() }
})
order.createdAt.getTime()  // ← compile error — createdAt is string, not Date
```

This prevents a class of bugs where code works on the first invocation (step runs, returns `Date`) but breaks on replay (step returns cached `string`). The `JsonSerializable<T>` type is similar to Inngest's `Jsonify<T>`.

For additional safety, `step.run` accepts an optional `schema` (see section 2.2) to validate the return value before persisting:

```ts
const order = await step.run("validate", () => this.orders.get(id), {
  schema: t.object({ id: t.uuid(), total: t.number() }),
})
// WorkflowSerializationError if the return value doesn't match the schema
```

**Runtime detection.** The framework detects likely non-determinism at runtime: if a `step.run` is called with an ID that doesn't match any cached step, AND there are cached steps with IDs that were never encountered in this invocation, a loud warning is logged: `"Possible non-deterministic step IDs detected: expected [cached IDs] but encountered [new ID]. This usually means a data fetch outside a step is producing different results on replay. Wrap it in step.run()."` This catches the common mistake of using un-memoized data to generate step IDs.

### 4.2 Failure & Retry

**When a step throws:**

1. The error is persisted on the `workflow_steps` record.
2. If the step has retries remaining (per-step or workflow default), it is rescheduled with backoff.
3. The next invocation replays cached steps, then re-attempts the failed step.
4. If retries exhausted: compensation runs (if any `rollback` handlers exist), then workflow transitions to `failed`.

Step-level retry is independent of workflow-level concerns. A step can retry 3 times across 3 separate invocations — each invocation replays the cached steps and re-attempts the failing step.

**When the handler throws outside a step:**

```ts
handler: async ({ step }) => {
  const order = await step.run("validate", () => this.orders.get(id))
  if (!order.canProcess) throw new AlephaError("Cannot process")  // ← outside a step
  await step.run("charge", () => this.payments.charge(order))
}
```

Handler-level throws (outside `step.*` calls) **immediately fail the workflow with no retry**. Retries are step-level only — there is no "step" to retry here. Compensation runs for all completed steps that have `rollback` handlers. The workflow transitions to `failed` (or `compensation_failed` if compensation fails).

If retry semantics are needed, wrap the logic in a `step.run`:

```ts
// Good: retryable via step policy
const order = await step.run("validate", async () => {
  const o = await this.orders.get(id)
  if (!o.canProcess) throw new AlephaError("Cannot process")
  return o
})
```

### 4.3 Timeout

Two levels:

- **Workflow timeout** (`timeout`): Max duration from start to completion. If exceeded, the workflow is cancelled with compensation.
- **Step timeout** (`stepTimeout` or per-step `timeout`): Max duration per step execution. If exceeded, the step fails and retry policy applies.

Timeouts use `AbortSignal.timeout()`. The handler receives `signal` in the context:

```ts
handler: async ({ input, step, workflowId, signal }) => {
  // signal is aborted on workflow timeout
  await step.run("long-task", async () => {
    // Per-step signal is separate — aborted on step timeout
    await longRunningOperation({ signal })
  })
}
```

**Workflow deadline enforcement:**

1. **At invocation start**: If `now > deadline`, the framework skips step execution and enters cancellation/compensation immediately. No step functions run.
2. **During step execution**: The workflow-level `AbortSignal` is triggered when the deadline passes (same `signal` in the handler context). The currently executing step receives the abort.
3. **Pending retry jobs**: On cancellation (including timeout-triggered), any pending retry jobs for this workflow are cancelled (set to `cancelled` in `job_executions`). This prevents a step with long backoff from continuing after the workflow is dead.

**Timeout vs retry interaction.** A step with `retry: { retries: 10, backoff: { initial: [5, "minute"], factor: 2 } }` inside a `timeout: [1, "hour"]` workflow will only retry as many times as the deadline allows. Once the deadline passes, the next invocation enters cancellation instead of re-attempting the step.

### 4.4 Signals

Signals are external events sent to a waiting workflow.

**Standard flow (signal arrives after `waitFor`):**

1. Handler calls `step.waitFor("event-name")`.
2. A `workflow_signals` record is inserted with status `waiting`.
3. Workflow suspends (no re-dispatch until signal arrives).
4. External code calls `workflow.signal(workflowId, "event-name", data)`.
5. Signal record UPSERTed to `received` with data (see UPSERT semantics below).
6. Workflow re-dispatched via `$job`. On invocation, `step.waitFor()` returns signal data.

**Buffered flow (signal arrives before `waitFor`):**

1. External code calls `workflow.signal(workflowId, "event-name", data)` — no `workflow_signals` row exists yet.
2. Signal record INSERTed with status `received` and data (UPSERT — INSERT path).
3. Later, handler reaches `step.waitFor("event-name")`. Finds the existing `received` row.
4. Returns the buffered data immediately without suspending.

**Signal UPSERT semantics.** `signal()` uses UPSERT on `(workflowId, signalName)`:

- **No existing row** → INSERT with `status: "received"`, `data`, `receivedAt = now`. This is the **buffered signal** case — the signal arrives before the workflow reaches `waitFor`. When the handler eventually calls `waitFor`, it finds the `received` row and returns the data immediately without suspending.
- **Existing row with `status: "waiting"`** → UPDATE to `status: "received"`, set `data` and `receivedAt`. Re-dispatch the workflow.
- **Existing row with `status: "received"`** → UPDATE `data` and `receivedAt` (last-write-wins). This allows callers to safely retry signal sends. The previous payload is overwritten.
- **Existing row with `status: "expired"`** → No effect. The signal arrived too late.

Orphaned signal rows (workflow never reaches that `waitFor` — e.g., early-exit loops) are cleaned up automatically by `ON DELETE CASCADE` when the execution is purged by the retention sweep.

**Warning: last-write-wins can silently lose data.** If two callers send different payloads for the same signal name, the first payload is overwritten. For workflows that receive multiple independent events (e.g., votes, approvals), **use unique signal names per event** — not a single shared name:

```ts
// Good: unique signal name per voter
for (let i = 0; i < total; i++) {
  const response = await step.waitFor(`vote-${i}`, { timeout: [48, "hour"] })
}

// Bad: single signal name for multiple events — second vote overwrites first
const vote1 = await step.waitFor("vote", ...)
const vote2 = await step.waitFor("vote", ...) // same name — unique constraint conflict
```

**Signal timeout sweep.** A system job (internal) runs every minute to check for expired signals. Expired signals transition to `expired` status and the workflow is re-dispatched — `step.waitFor()` throws `WorkflowTimeoutError`.

### 4.5 Parallel Execution

No special primitive needed. Use native `Promise.all` with multiple `step.run` calls:

```ts
const [user, order, settings] = await Promise.all([
  step.run("fetch-user", () => this.users.get(id)),
  step.run("fetch-order", () => this.orders.get(orderId)),
  step.run("fetch-settings", () => this.settings.get(id)),
])
```

**How it works internally (two-phase model):**

1. `Promise.all` calls all three `step.run` functions synchronously (they're not async at the registration level).
2. Each `step.run` checks the memoization map independently.
3. Cached steps return a resolved promise with the stored result.
4. New steps return a sentinel promise (never resolves) and are registered as pending.
5. `Promise.all` stalls on the sentinel promises. After a microtask, the framework detects the stall.
6. The framework collects all pending steps, executes them in parallel, persists results to `workflow_steps`, and re-dispatches via `$job`.
7. On the next invocation, all three steps are cached → `Promise.all` resolves instantly. Handler continues.

**Persistence: individual, not batched.** Each step result is persisted to `workflow_steps` individually as it completes — not batched at the end of Phase 2. If the worker crashes mid-Phase-2 after step A completes but before step B finishes, A's result is safe in the database. On re-invocation, A is cached and only B re-executes. This is critical for idempotency — re-executing A would repeat its side effects.

**Concurrency throttling.** When Phase 2 has more pending steps than `maxParallelSteps` (default: 50), the framework executes them in batches using an internal semaphore. This is transparent to the user — `Promise.all` works the same way. The throttle prevents overwhelming external APIs or the database connection pool when dynamic step generation fans out (e.g., `files.map(f => step.run(...))`).

**Failure semantics.** If any parallel step fails during Phase 2, other steps that already started continue to completion (their results are individually persisted). The failed step's error is also persisted. On re-invocation, successful steps are cached and only the failed step re-executes (per its retry policy). If a step exhausts retries, the workflow enters failure/compensation.

**Why not a `step.parallel()` primitive?** Because `Promise.all` + `step.run` already does exactly the right thing. Each step is independently memoized. The framework detects which steps are new vs cached. No framework-specific API to learn — just standard JavaScript concurrency.

### 4.6 Child Workflows

`step.invoke()` starts a child workflow and waits for completion:

- Child has its own `workflow_executions` record with `parentId` set.
- Parent suspends until child completes (via a signal mechanism internally).
- If parent is cancelled, child is cancelled too (cascading cancellation) — unless `detached: true`.
- If child fails (after its own retry/compensation), parent's step fails (parent's retry policy applies).
- **Detached children** (`{ detached: true }`) are not cancelled when the parent cancels. They run to completion independently. Use for critical cleanup, shared workflows, or work that must not be interrupted.

**Idempotent child creation.** `step.invoke` uses the insert-before-execute model (section 3.7). Before starting the child, it inserts a `workflow_steps` row with `status: "running"`. The child workflow is started with an internal dedup key: `_parent:{parentWorkflowId}:step:{stepId}`. On crash and re-invocation:

1. The memoization map finds the `running` row for this step.
2. The framework checks if a child workflow with the dedup key exists.
3. If the child is still running → re-attach (suspend parent until child completes). No duplicate child started.
4. If the child completed → read its output, update the step to `completed`, return the result.
5. If the child failed → update the step to `failed`, apply retry policy.

### 4.7 Unique Workflows (Deduplication)

Same mechanism as `$job`'s `key`. Only one workflow with a given key can be active (`running`, `waiting`, or `sleeping`).

```ts
await this.processOrder.start(
  { orderId: "abc" },
  { key: `order_abc` },
)
// Second call with same key → returns existing workflowId
```

**Start-or-join pattern** with `findByKey`:

```ts
const key = `order_${orderId}`
const existing = await this.processOrder.findByKey(key)
if (existing) {
  return { workflowId: existing.workflowId, alreadyRunning: true }
}
const { workflowId } = await this.processOrder.start(input, { key })
return { workflowId, alreadyRunning: false }
```

The `key` column is set to `null` when the workflow leaves the active states (`running`, `waiting`, `sleeping`). This includes transitions to `compensating`, `completed`, `failed`, `cancelled`, and `compensation_failed`. A workflow in compensation is unwinding, not active — the key must be freed so callers can start new workflows immediately rather than receiving a reference to a dying one.

### 4.8 Concurrency

`concurrency` limits the number of **logical workflow instances** in active states (`running`, `waiting`, `sleeping`) — not the number of concurrent handler invocations. This is workflow-layer concurrency, enforced at `start()` time:

```ts
processOrder = $workflow({
  concurrency: 5,
  // ...
})
```

When `start()` is called and the active count for this workflow definition already equals `concurrency`, the call throws `WorkflowConcurrencyError`. This prevents the scenario where 100 workflows are all `waiting` for signals — they count against the limit even though no handler is running.

**This differs from `$job` concurrency**, which limits concurrent handler invocations (useful for controlling resource usage). Workflow concurrency is about logical instance count. The underlying `$job` invocations are not concurrency-limited by the workflow layer — the framework manages re-dispatch internally.

### 4.9 Versioning

Workflows support **semantic versioning** for safe deployments. When a workflow definition includes a `version`, it is recorded on the execution at start time. On each invocation, the framework resolves the correct handler implementation for that execution's version.

```ts
class OrderWorkflows {
  protected readonly orders = $inject(OrderService)

  // --- Version 1: original implementation ---
  processOrder = $workflow({
    schema: t.object({ orderId: t.uuid(), userId: t.uuid() }),
    version: "1.0.0",

    handler: async ({ input, step }) => {
      const order = await step.run("validate", () => this.orders.get(input.orderId))
      await step.run("charge", () => this.payments.chargeV1(order))
      await step.run("notify", () => this.notifications.send(input.userId))
      return { orderId: order.id }
    },
  })
}
```

When you need to change the workflow logic, bump the version. Old executions that started on `"1.0.0"` continue using the `"1.0.0"` handler. New executions use `"2.0.0"`:

```ts
class OrderWorkflows {
  protected readonly orders = $inject(OrderService)

  // --- Version 2: new step added, charge logic changed ---
  processOrder = $workflow({
    schema: t.object({ orderId: t.uuid(), userId: t.uuid() }),
    version: "2.0.0",

    // Keep the old handler for in-flight v1 executions
    versions: {
      "1.0.0": async ({ input, step }) => {
        const order = await step.run("validate", () => this.orders.get(input.orderId))
        await step.run("charge", () => this.payments.chargeV1(order))
        await step.run("notify", () => this.notifications.send(input.userId))
        return { orderId: order.id }
      },
    },

    handler: async ({ input, step }) => {
      const order = await step.run("validate", () => this.orders.get(input.orderId))
      await step.run("fraud-check", () => this.fraud.check(order))  // new step
      await step.run("charge", () => this.payments.chargeV2(order)) // changed logic
      await step.run("notify", () => this.notifications.send(input.userId))
      return { orderId: order.id }
    },
  })
}
```

**How it works:**

1. On `workflow.start()`, the current `version` is recorded on the `workflow_executions` row.
2. On each invocation, the framework reads the execution's `version` field.
3. If `version` matches a key in `versions`, that handler is used.
4. If `version` matches the current definition's `version` (or is `null`), the main `handler` is used.
5. If no matching handler is found, the workflow fails with `WorkflowVersionError`.

**When to use versioning:**

- **Additive changes** (new optional steps after existing ones): No version bump needed — old executions won't reach the new steps, and new executions will.
- **Breaking changes** (removing steps, changing step IDs, changing step order): Bump version and keep old handler in `versions` until all old executions drain.
- **Logic changes** (different behavior in existing steps): Bump version if the change would break in-flight executions.

**Input schema is only used at `start()` time for validation.** The validated input is persisted to `workflow_executions.input`. On each invocation, the handler receives input from the database — not from a new validation pass. This means a v1 handler in `versions` always receives v1 input (validated against the schema that was active when the execution started), even if the current schema has changed for v2. No cross-version schema mismatch is possible.

**Unversioned workflows** (no `version` field) always use the current `handler`. This is fine for short-lived workflows that complete quickly and don't span deployments.

### 4.10 Heartbeat Protocol

Each workflow invocation maintains a heartbeat to enable fast crash detection:

1. **On claim**: Worker sets `heartbeatAt = now + heartbeatInterval` on the execution.
2. **During execution**: Worker extends `heartbeatAt` periodically (every `heartbeatInterval`, default: 30s).
3. **On completion**: `heartbeatAt` is cleared (set to `null`).
4. **Heartbeat sweep** (internal system job, runs every `heartbeatInterval`): Queries `workflow_executions WHERE status IN ('running', 'compensating') AND heartbeatAt < now`. Marks these as stale and re-dispatches via `$job`. Compensation runs as a separate invocation sequence — workers crash during compensation too, and the sweep must detect this.

Detection latency: **1-2x heartbeatInterval** (30-60 seconds by default). This is significantly faster than the `$job` recovery sweep (60-second poll + 5-minute stale threshold).

**Within-step heartbeat extension.** The heartbeat is extended during step execution, not just between steps. If a single step runs for longer than `heartbeatInterval`, the framework continues extending the heartbeat in the background. This prevents false-positive crash detection for long-running steps (e.g., a 2-minute PDF generation within a step with a 5-minute timeout).

**Idempotency requirement.** Because crash recovery re-executes the interrupted step, step functions MUST be idempotent — safe to call more than once. If a step completed its side effect (e.g., charged a payment) but crashed before persisting the result, the re-invocation will execute the step again. Use idempotency keys in external API calls:

```ts
handler: async ({ input, step, workflowId }) => {
  // ...
  await step.run("charge", async () => {
    // Use workflowId (from handler context) as an idempotency key
    return this.payments.charge({
      amount: order.total,
      idempotencyKey: `workflow_${workflowId}_charge`,
    })
  })
}
```

The heartbeat sweep does NOT modify step state — it only re-dispatches the workflow. The re-invocation replays cached steps and re-attempts the interrupted step. No data loss, no corruption.

---

## 5. Database Entities

### 5.1 Workflow Execution Entity

```ts
import { $entity, db } from "alepha/orm"
import { t } from "alepha"

export const workflowExecutionEntity = $entity({
  name: "workflow_executions",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    workflowName: t.text(),                                // e.g. "OrderWorkflows.processOrder"
    version: t.optional(t.text()),                         // semantic version, locked at start time
    key: t.optional(t.text()),                             // set to null on completion/failure/cancel

    input: t.optional(t.record(t.text(), t.any())),        // validated input
    output: t.optional(t.any()),                             // handler return value (any serializable JSON type)
    // Note: admin API resource schema wraps output as t.optional(t.record(t.text(), t.any()))
    // to satisfy HTTP response validation. Non-object outputs are wrapped: { value: <output> }
    status: db.default(
      t.enum(["running", "waiting", "sleeping", "compensating", "completed", "failed", "cancelled", "compensation_failed"]),
      "running",
    ),
    priority: db.default(t.integer({ minimum: 0, maximum: 3 }), 2),

    // currentStepId: derived from workflow_steps WHERE status = 'running'.
    // Not stored — meaningless during parallel execution (multiple steps active simultaneously).
    // stepsCompleted: derived at query time via COUNT(*) FROM workflow_steps WHERE status = 'completed'.
    // Not stored — avoids race condition during parallel step persistence (Phase 2).
    invocations: db.default(t.integer(), 0),               // number of handler invocations (for safety limit)

    startedAt: t.optional(t.datetime()),
    completedAt: t.optional(t.datetime()),
    deadline: t.optional(t.datetime()),                    // workflow-level timeout deadline
    heartbeatAt: t.optional(t.datetime()),                 // extended periodically during execution

    parentId: t.optional(t.uuid()),                        // child workflow — points to parent

    error: t.optional(t.text()),                           // error message + stack trace

    triggeredBy: t.optional(t.text()),                     // user ID (manual trigger)
    triggeredByName: t.optional(t.text()),                 // user display name
    cancelledBy: t.optional(t.text()),                     // user ID (cancel)
    cancelledByName: t.optional(t.text()),                 // user display name
  }),
  indexes: [
    { columns: ["workflowName", "status"] },
    { columns: ["workflowName", "key"], unique: true, where: "key IS NOT NULL" },
    { columns: ["parentId"] },
    { columns: ["completedAt"] },
    { columns: ["status", "deadline"] },
    { columns: ["status", "heartbeatAt"] },                // for heartbeat sweep
  ],
})

export type WorkflowExecutionEntity = Static<typeof workflowExecutionEntity.schema>
```

### 5.2 Workflow Step Entity

```ts
export const workflowStepEntity = $entity({
  name: "workflow_steps",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    createdAt: db.createdAt(),

    workflowId: t.uuid(),                                  // FK to workflow_executions
    stepId: t.text(),                                      // user-defined step ID (memoization key)
    ordinal: t.integer(),                                  // monotonic registration order (for compensation sequence)
    type: t.enum(["run", "sleep", "waitFor", "invoke"]),

    status: t.enum(["running", "completed", "failed", "rolled_back"]),
    // No default — always provided explicitly. INSERT uses "running" (insert-before-execute).

    result: t.optional(t.any()),                             // persisted return value (any serializable type)
    error: t.optional(t.text()),                           // error on failure

    attempt: db.default(t.integer(), 0),                   // incremented at execution time
    maxAttempts: db.default(t.integer(), 1),               // retries + 1

    startedAt: t.optional(t.datetime()),
    completedAt: t.optional(t.datetime()),
    scheduledAt: t.optional(t.datetime()),                 // for sleep/delayed retry

    hasRollback: db.default(t.boolean(), false),           // whether this step has a compensation handler
    rolledBackAt: t.optional(t.datetime()),                // when rollback completed
  }),
  indexes: [
    { columns: ["workflowId", "stepId"], unique: true },
    { columns: ["workflowId", "status"] },
  ],
})

export type WorkflowStepEntity = Static<typeof workflowStepEntity.schema>
```

### 5.3 Workflow Signal Entity

```ts
export const workflowSignalEntity = $entity({
  name: "workflow_signals",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    createdAt: db.createdAt(),

    workflowId: t.uuid(),                                  // FK to workflow_executions
    signalName: t.text(),                                  // matches step.waitFor(name)

    status: db.default(t.enum(["waiting", "received", "expired"]), "waiting"),
    data: t.optional(t.record(t.text(), t.any())),         // signal payload

    deadline: t.optional(t.datetime()),                    // timeout deadline
    receivedAt: t.optional(t.datetime()),
  }),
  indexes: [
    { columns: ["workflowId", "signalName"], unique: true },
    { columns: ["status", "deadline"] },
  ],
})

export type WorkflowSignalEntity = Static<typeof workflowSignalEntity.schema>
```

### 5.4 Entity Relationship

```
workflow_executions (1) ──── (N) workflow_steps
workflow_executions (1) ──── (N) workflow_signals
workflow_executions (1) ──── (N) workflow_executions (children via parentId)
workflow_executions (N) ──── (N) job_executions (each invocation is a $job execution)
```

The `workflow_steps` table is the **hot table** for memoization — queried on every invocation. It must be fast. Step result data is JSONB, typically small (the return value of each step function).

**Cascade deletes.** The `workflowId` foreign keys on `workflow_steps` and `workflow_signals` use `ON DELETE CASCADE`. When the retention sweep deletes old `workflow_executions` rows, their associated steps and signals are automatically removed. No orphaned rows.

---

## 6. Provider: `WorkflowProvider`

Central orchestrator for the workflow lifecycle.

```ts
import { $inject, $logger, $use } from "alepha"
import { $repository } from "alepha/orm"
import { JobProvider } from "alepha/api/jobs"

export class WorkflowProvider {
  protected readonly alepha = $inject(Alepha)
  protected readonly config = $use(workflowConfig)
  protected readonly jobProvider = $inject(JobProvider)
  protected readonly executions = $repository(workflowExecutionEntity)
  protected readonly steps = $repository(workflowStepEntity)
  protected readonly signals = $repository(workflowSignalEntity)
  protected readonly log = $logger()

  /**
   * Register a workflow definition. Called by the $workflow primitive during onInit().
   */
  public registerWorkflow(name: string, options: WorkflowOptions): void { /* ... */ }

  /**
   * Start a new workflow execution.
   */
  public async start(name: string, input: unknown, options?: StartOptions): Promise<{ workflowId: string }> { /* ... */ }

  /**
   * Send a signal to a waiting workflow.
   */
  public async signal(workflowId: string, name: string, data?: unknown): Promise<void> { /* ... */ }

  /**
   * Cancel a running workflow. Triggers compensation.
   */
  public async cancel(workflowId: string, context?: CancelContext): Promise<void> { /* ... */ }

  /**
   * Get current workflow status and step progress.
   */
  public async getStatus(workflowId: string): Promise<WorkflowStatus> { /* ... */ }

  /**
   * Wait for a workflow to reach a terminal state. Returns the output.
   * Throws WorkflowTimeoutError if timeout expires. Throws WorkflowFailedError if workflow failed.
   */
  public async waitFor(workflowId: string, options?: { timeout?: Duration }): Promise<unknown> { /* ... */ }

  /**
   * Find a workflow by its dedup key. Returns null if no active workflow with that key.
   */
  public async findByKey(key: string): Promise<{ workflowId: string; status: string } | null> { /* ... */ }

  /**
   * Internal: invoke the workflow handler (called by the internal $job).
   */
  protected async invoke(workflowId: string): Promise<void> { /* ... */ }

  /**
   * Internal: run compensation handlers in reverse order.
   */
  protected async compensate(workflowId: string): Promise<void> { /* ... */ }

  /**
   * Test-only: run all invocations synchronously until the workflow completes or suspends.
   * Treats step.sleep as instantly completed. Throws if maxInvocations is exceeded.
   */
  public async drain(workflowId: string): Promise<void> { /* ... */ }
}
```

### 6.1 Invocation Lifecycle

1. **Start**: Validate input against schema. Insert `workflow_executions` record with current `version`. Dispatch first invocation via internal `$job.push({ workflowId })`.
2. **Invoke**: Load execution record (including `version`). Resolve handler for this version. Load all `workflow_steps` rows (all statuses). Build memoization map. Set initial heartbeat.
3. **Heartbeat**: Extend `heartbeatAt` periodically during execution (every `heartbeatInterval`).
4. **Step hit (cached)**: Return resolved promise with cached result. Handler continues.
5. **Step hit (new)**: Return sentinel promise (never resolves). Register step as pending.
6. **Stall detected**: After microtask, collect all pending steps. Execute in parallel, persist results to `workflow_steps`. Re-dispatch via `$job`.
7. **Sleep**: Set `scheduledAt` on re-dispatch. Workflow status → `sleeping`. Clear heartbeat.
8. **WaitFor**: Insert `workflow_signals` record. Workflow status → `waiting`. Clear heartbeat. No re-dispatch until signal arrives.
9. **Signal received**: Update signal record. Re-dispatch invocation. Workflow status → `running`.
10. **Parallel** (`Promise.all`): Multiple `step.run` calls return sentinels synchronously. `Promise.all` stalls. Framework collects all pending steps, executes in parallel, persists results, re-dispatches.
11. **Handler returns**: Persist output. Mark workflow `completed`. Set `key` to `null`. Clear heartbeat. Emit `workflow:complete` event.
12. **Handler throws (outside a step)**: No retry (retries are step-level). Run compensation for all completed steps with rollbacks. Mark workflow `failed` or `compensation_failed`. See section 4.2.
13. **Handler throws (step retry exhaustion)**: Run compensation (status → `compensating`). On completion, mark workflow `failed` or `compensation_failed`. Clear heartbeat. Emit events.
14. **Signal cleanup**: On any terminal transition (`failed`, `cancelled`, `compensation_failed`), update all `waiting` signals for this workflow to `expired`. Prevents orphaned signal records.
15. **Crash detected** (heartbeat expired): Heartbeat sweep re-dispatches the workflow. Next invocation replays cached steps and re-attempts the interrupted step.

### 6.2 Lifecycle Events

```ts
alepha.on("workflow:start", ({ name, workflowId, input }) => { /* ... */ })
alepha.on("workflow:step:start", ({ name, workflowId, stepId }) => { /* ... */ })
alepha.on("workflow:step:complete", ({ name, workflowId, stepId, duration }) => { /* ... */ })
alepha.on("workflow:step:fail", ({ name, workflowId, stepId, error }) => { /* ... */ })
alepha.on("workflow:signal", ({ name, workflowId, signalName, data }) => { /* ... */ })
alepha.on("workflow:complete", ({ name, workflowId, output, duration }) => { /* ... */ })
alepha.on("workflow:fail", ({ name, workflowId, error }) => { /* ... */ })
alepha.on("workflow:cancel", ({ name, workflowId }) => { /* ... */ })
alepha.on("workflow:compensate", ({ name, workflowId, stepId }) => { /* ... */ })
alepha.on("workflow:compensation_failed", ({ name, workflowId, error }) => {
  // Critical: compensation is stuck. Wire up alerting here.
  this.alerting.page("Workflow compensation stuck", { workflowId, error })
})
alepha.on("workflow:version:drained", ({ name, version }) => {
  // All executions for this version have completed. Safe to remove from versions map.
  this.log.info(`Version ${version} of ${name} fully drained`)
})
```

---

## 7. Module Registration

```ts
import { $module } from "alepha"

export const AlephaApiWorkflows = $module({
  name: "alepha.api.workflows",
  imports: [AlephaApiJobs],                    // depends on $job v2
  services: [WorkflowProvider, WorkflowService, AdminWorkflowController],
  primitives: [$workflow],
})
```

---

## 8. Configuration

### 8.1 Config Atom

```ts
import { $atom, t } from "alepha"

export const workflowConfig = $atom({
  name: "alepha.workflows",
  description: "Configuration for the $workflow primitive.",
  schema: t.object({
    defaultStepTimeout: durationSchema({ description: "Default step timeout." }),
    defaultWorkflowTimeout: durationSchema({ description: "Default workflow timeout. null = no timeout." }),
    maxInvocations: t.integer({ description: "Max invocations per workflow (safety limit against infinite loops)." }),
    warnStepCount: t.integer({ description: "Emit warning when a workflow exceeds this step count." }),
    maxParallelSteps: t.integer({ description: "Max steps executed concurrently in Phase 2. Excess steps are batched." }),
    signalExpiry: durationSchema({ description: "Default signal wait timeout." }),
    compensationRetries: t.integer({ description: "Max retries for compensation handlers." }),
    retentionDays: t.integer({ description: "Days to keep completed/failed workflow records." }),
    signalSweepInterval: durationSchema({ description: "Interval for checking expired signals." }),
    heartbeatInterval: durationSchema({ description: "Interval for heartbeat extension and crash detection sweep." }),
  }),
  default: {
    defaultStepTimeout: [5, "minute"],
    defaultWorkflowTimeout: null,              // no timeout
    maxInvocations: 1000,                      // safety limit
    warnStepCount: 100,                        // log warning above this
    maxParallelSteps: 50,                      // Phase 2 concurrency cap
    signalExpiry: [24, "hour"],
    compensationRetries: 3,
    retentionDays: 30,
    signalSweepInterval: [1, "minute"],
    heartbeatInterval: [30, "second"],
  },
})
```

### 8.2 Overriding Per Environment

```ts
// alepha.config.ts (development)
import { workflowConfig } from "alepha/api/workflows"

export default defineConfig({
  atoms: {
    [workflowConfig.key]: {
      signalSweepInterval: [5, "second"],      // aggressive sweep in dev
      maxInvocations: 100,                     // lower safety limit in dev
    },
  },
})
```

---

## 9. Observability

### 9.1 Structured Logging

Every workflow invocation and step emits structured logs:

```
[workflow] OrderWorkflows.processOrder | wf=abc123 | invocation=3 | status=running
[workflow] OrderWorkflows.processOrder | wf=abc123 | step=charge | attempt=1/4 | status=completed | duration=1.2s
[workflow] OrderWorkflows.processOrder | wf=abc123 | step=warehouse-confirm | status=waiting
[workflow] OrderWorkflows.processOrder | wf=abc123 | status=completed | steps=5 | duration=4h 12m
```

### 9.2 Admin Controller

All endpoints require authentication and are grouped under `admin:workflows`.

```ts
export class AdminWorkflowController {
  protected readonly url = "/workflows"
  protected readonly group = "admin:workflows"
  protected readonly workflowService = $inject(WorkflowService)

  /**
   * Dashboard stats: active workflows, completed/failed 24h, waiting signals.
   */
  public readonly getStats = $action({
    path: `${this.url}/stats`,
    group: this.group,
    secure: true,
    description: "Get workflow dashboard statistics",
    schema: {
      response: workflowStatsSchema,
    },
    handler: () => this.workflowService.getStats(),
  })

  /**
   * List all registered workflow definitions.
   */
  public readonly getRegistry = $action({
    path: this.url,
    group: this.group,
    secure: true,
    description: "List all registered workflow definitions",
    schema: {
      response: t.array(workflowRegistrationSchema),
    },
    handler: () => this.workflowService.getRegistry(),
  })

  /**
   * Paginated workflow execution history with filtering.
   */
  public readonly findExecutions = $action({
    path: `${this.url}/executions`,
    group: this.group,
    secure: true,
    description: "Query workflow execution history",
    schema: {
      query: workflowExecutionQuerySchema,
      response: t.page(workflowExecutionResourceSchema),
    },
    handler: ({ query }) => this.workflowService.findExecutions(query),
  })

  /**
   * Single workflow execution with all steps and signals.
   */
  public readonly getExecution = $action({
    path: `${this.url}/executions/:id`,
    group: this.group,
    secure: true,
    description: "Get workflow execution with steps",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: workflowExecutionDetailResourceSchema,
    },
    handler: ({ params }) => this.workflowService.getExecution(params.id),
  })

  /**
   * Manually start a workflow.
   */
  public readonly triggerWorkflow = $action({
    method: "POST",
    path: `${this.url}/trigger`,
    group: this.group,
    secure: true,
    description: "Manually start a workflow",
    schema: {
      body: triggerWorkflowSchema,
      response: t.object({ workflowId: t.uuid() }),
    },
    handler: ({ body, user }) =>
      this.workflowService.triggerWorkflow(body.name, {
        input: body.input,
        triggeredBy: user.id,
        triggeredByName: user.name,
      }),
  })

  /**
   * Send a signal to a waiting workflow.
   */
  public readonly sendSignal = $action({
    method: "POST",
    path: `${this.url}/executions/:id/signal`,
    group: this.group,
    secure: true,
    description: "Send signal to a waiting workflow",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: t.object({
        name: t.text(),
        data: t.optional(t.record(t.text(), t.any())),
      }),
      response: okSchema,
    },
    handler: ({ params, body }) =>
      this.workflowService.sendSignal(params.id, body.name, body.data),
  })

  /**
   * Cancel a running/waiting workflow.
   */
  public readonly cancelWorkflow = $action({
    method: "POST",
    path: `${this.url}/executions/:id/cancel`,
    group: this.group,
    secure: true,
    description: "Cancel a workflow",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: okSchema,
    },
    handler: ({ params, user }) =>
      this.workflowService.cancelWorkflow(params.id, {
        cancelledBy: user.id,
        cancelledByName: user.name,
      }),
  })

  /**
   * Retry a failed workflow.
   *
   * Resets the workflow to "running" and re-dispatches. On the next invocation:
   * - "completed" steps → cached (not re-executed).
   * - "rolled_back" steps → re-executed (compensation undid the side effect).
   * - "failed" step → re-executed (with retry counter reset).
   *
   * Note: this is NOT "retry from the failed step only" — all rolled-back steps
   * earlier in the workflow also re-execute since their side effects were undone.
   */
  public readonly retryWorkflow = $action({
    method: "POST",
    path: `${this.url}/executions/:id/retry`,
    group: this.group,
    secure: true,
    description: "Retry a failed workflow",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: okSchema,
    },
    handler: ({ params, user }) =>
      this.workflowService.retryWorkflow(params.id, {
        triggeredBy: user.id,
        triggeredByName: user.name,
      }),
  })

  /**
   * Retry compensation for a workflow stuck in `compensation_failed` status.
   */
  public readonly retryCompensation = $action({
    method: "POST",
    path: `${this.url}/executions/:id/retry-compensation`,
    group: this.group,
    secure: true,
    description: "Retry failed compensation handlers",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: okSchema,
    },
    handler: ({ params, user }) =>
      this.workflowService.retryCompensation(params.id, {
        triggeredBy: user.id,
        triggeredByName: user.name,
      }),
  })
}
```

### 9.3 Admin UI

The workflows admin UI provides 5 views: **Dashboard**, **Registry**, **Executions**, **Execution Detail**, and **Signals**. It follows the existing devtools visual language (`@alepha/ui`, `midnightTheme`, `ui.colors.*` tokens, `@tabler/icons-react`).

#### 9.3.1 Dashboard

Overview with real-time stats. Polls every 10s.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Workflows                                                                    │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │  8            │  │  3           │  │  2           │  │  1           │    │
│  │  Registered   │  │  Running     │  │  Waiting     │  │  Failed      │    │
│  │              │  │              │  │  for signal  │  │  ▲ Needs     │    │
│  │              │  │              │  │              │  │    attention  │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │  124          │  │  2           │  │  47s         │  │  1           │    │
│  │  Completed    │  │  Sleeping    │  │  Avg step    │  │  Compensating│    │
│  │  24h          │  │              │  │  duration    │  │              │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                                              │
│  Throughput (24h)                            Completion rate (24h)           │
│  ┌─────────────────────────────────┐        ┌────────────────────────┐     │
│  │  ▁▂▃▅▇▇▅▃▂▁▁▂▃▅▇█▇▅▃▂▁▁▂▃▅▇ │        │  ▇▇▇▇▇▇▆▇▇▇▇▇▇▇▇▇▇▇ │     │
│  │  00:00      06:00      12:00   │        │  97.2%    avg          │     │
│  └─────────────────────────────────┘        └────────────────────────┘     │
│                                                                              │
│  Active Workflows                                                            │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  STATUS  WORKFLOW                  VERSION  PROGRESS  STARTED  SINCE  │  │
│  │  ──────────────────────────────────────────────────────────────────── │  │
│  │  ● run   OrderWorkflows.process    v2.0.0   4 done ███  14:30   2m    │  │
│  │  ◐ wait  OrderWorkflows.process    v2.0.0   2 done █░░  14:25   7m   │  │
│  │          ↳ Waiting for: warehouse-confirm (3h 42m left)              │  │
│  │  ● run   ApprovalWorkflows.req     v1.0.0   1 done █░░  14:20  12m  │  │
│  │  ◑ sleep DataWorkflows.etl         —        1 done █░░  02:00  12h  │  │
│  │          ↳ Sleeping until Feb 11, 02:00                              │  │
│  │  ● run   OrderWorkflows.process    v1.0.0   5 done ███  14:05  27m  │  │
│  │          ↳ Running on old version (v2.0.0 is current)                │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  Recent Failures                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  WORKFLOW                     STEP              ERROR                  │  │
│  │  ──────────────────────────────────────────────────────────────────── │  │
│  │  PaymentWorkflows.refund      charge-back       Gateway timeout       │  │
│  │  OrderWorkflows.process       ship              Carrier API 503       │  │
│  │  DataWorkflows.etl            transform-f12     Parse error: col 4    │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

#### 9.3.2 Registry

All registered `$workflow` definitions with their configuration, versions, and step topology. Read-only.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Workflows > Registry                                               8 defs  │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌ Search ──────────────────────┐  Filter: [All] [Cron] [Versioned]        │
│  │  🔍 Search workflows...      │                                           │
│  └──────────────────────────────┘                                           │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                                                                        │  │
│  │  OrderWorkflows.processOrder                             v2.0.0       │  │
│  │  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │  │
│  │  schema: { orderId: uuid, userId: uuid }                              │  │
│  │  timeout: 1h | step timeout: 5m | retry: 3/exp | concurrency: 5      │  │
│  │  versions: v1.0.0 (2 active runs), v2.0.0 (current)                  │  │
│  │  steps: validate → charge ↩ → warehouse-confirm ◐ → ship ∥           │  │
│  │         invoice ∥ → notify                                            │  │
│  │  [ Trigger ]                                                          │  │
│  │                                                                        │  │
│  │  ApprovalWorkflows.requestApproval                       v1.0.0       │  │
│  │  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │  │
│  │  schema: { requestId: uuid, approverIds: uuid[], requiredApprovals }  │  │
│  │  timeout: 7d | retry: 0 | concurrency: 1                             │  │
│  │  steps: notify-approvers → vote-{i} ◐ (loop) → finalize              │  │
│  │  [ Trigger ]                                                          │  │
│  │                                                                        │  │
│  │  DataWorkflows.dailyEtl                                  —            │  │
│  │  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │  │
│  │  cron: 0 2 * * * (every day at 02:00) | lock: true                   │  │
│  │  timeout: 4h | retry: 0 | concurrency: 1                             │  │
│  │  steps: extract → transform-{id} ∥ (dynamic) → load                  │  │
│  │  next run: Feb 11, 2026 02:00                                         │  │
│  │  [ Trigger Now ]                                                      │  │
│  │                                                                        │  │
│  │  OnboardingWorkflows.onboardUser                         —            │  │
│  │  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │  │
│  │  schema: { userId: uuid, teamId: uuid }                               │  │
│  │  timeout: none | retry: 3/exp | concurrency: 1                        │  │
│  │  steps: setup-profile → provision-team ▸ (child) → welcome-email      │  │
│  │  [ Trigger ]                                                          │  │
│  │                                                                        │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  Legend:  ↩ has rollback  ◐ waitFor  ∥ parallel  ▸ child workflow           │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

#### 9.3.3 Executions

Searchable, filterable execution history. Click a row to open detail view.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Workflows > Executions                                                       │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌ Search ──────────────────────┐  Workflow: [All workflows     ▾]          │
│  │  🔍 Search by ID, key...     │  Status: [All] [Running] [Waiting]        │
│  └──────────────────────────────┘         [Sleeping] [Failed] [Cancelled]   │
│                                    Version: [All versions ▾]                 │
│                                    Period:  [Last 24h ▾]                     │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  STATUS  WORKFLOW                  VER     PROGRESS  STARTED  DURATION│  │
│  │  ──────────────────────────────────────────────────────────────────── │  │
│  │  ● run   OrderWorkflows.process    v2.0.0  4 done ███  14:30   ...    │  │
│  │          ↳ Step: ship (running, attempt 1/4)                          │  │
│  │  ◐ wait  OrderWorkflows.process    v2.0.0  2 done █░░  14:25   7m    │  │
│  │          ↳ Signal: warehouse-confirm (3h 42m left)                    │  │
│  │  ● done  OrderWorkflows.process    v2.0.0  6 done ████  14:10   12m   │  │
│  │  ● done  OrderWorkflows.process    v1.0.0  6 done ████  14:05   18m   │  │
│  │          ↳ Ran on old version (v2.0.0 is current)                     │  │
│  │  ● fail  PaymentWorkflows.refund   v1.0.0  2 done ██░  13:50   3m   │  │
│  │          ↳ Error: Gateway timeout at step "charge-back"               │  │
│  │  ⟲ comp  PaymentWorkflows.refund   v1.0.0  2 done ██░  13:45   4m   │  │
│  │          ↳ Compensation failed: rollback "reserve" timed out          │  │
│  │  ◑ sleep DataWorkflows.etl         —       1 done █░░  02:00   12h  │  │
│  │          ↳ Sleeping until Feb 11, 02:00                               │  │
│  │  ✕ cncl  ApprovalWorkflows.req     v1.0.0  1 done █░░  12:00   2h   │  │
│  │          ↳ Cancelled by John Doe                                      │  │
│  │                                                                        │  │
│  │  ‹ 1  2  3  4  5 ... 12 ›                       Showing 1-20 of 231  │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

#### 9.3.4 Execution Detail

Full execution detail with step progress, signals, heartbeat, version, and actions.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Workflows > Executions > wf-a1b2c3d4                                         │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  OrderWorkflows.processOrder                                    v2.0.0      │
│  ◐ waiting  ·  2 completed  ·  Waiting for: warehouse-confirm               │
│                                                                              │
│  ┌ Actions ────────────────────────────────────────────────────────────────┐ │
│  │  [ Send Signal ]    [ Cancel ]    [ Retry ]                             │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌ Steps ──────────────────────────────────────────────────────────────────┐ │
│  │                                                                          │ │
│  │  #  STEP                STATUS     DURATION   RESULT                    │ │
│  │  ──────────────────────────────────────────────────────────────────────│ │
│  │  1  validate            ✓ done     34ms       { order: { id: "abc",   │ │
│  │                                                  total: 99.00, ... } } │ │
│  │  2  charge              ✓ done     1.2s       { paymentId: "pay_123" }│ │
│  │                         ↩ rollback available                           │ │
│  │  3  warehouse-confirm   ◐ waiting  —          —                        │ │
│  │                         timeout: 4h (3h 42m remaining)                 │ │
│  │                                                                          │ │
│  │  Steps beyond this point are not yet registered (no DB rows).          │ │
│  │  They will appear as the workflow progresses.                          │ │
│  │                                                                          │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌ Send Signal ────────────────────────────────────────────────────────────┐ │
│  │  Signal name:  warehouse-confirm                                        │ │
│  │  ┌──────────────────────────────────────────────────────────────────┐  │ │
│  │  │  {                                                                │  │ │
│  │  │    "warehouseId": "wh-01",                                        │  │ │
│  │  │    "estimatedShipDate": "2026-02-15"                              │  │ │
│  │  │  }                                                                │  │ │
│  │  └──────────────────────────────────────────────────────────────────┘  │ │
│  │  [ Send ]                                                               │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌ Input ──────────────────────────────────────────────────────────────────┐ │
│  │  {                                                                       │ │
│  │    "orderId": "abc-123",                                                 │ │
│  │    "userId": "xyz-789"                                                   │ │
│  │  }                                                                       │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌ Timeline ───────────────────────────────────────────────────────────────┐ │
│  │  14:25:00.000  Workflow started (v2.0.0, invocation 1)                  │ │
│  │  14:25:00.012  Step "validate" started                                  │ │
│  │  14:25:00.046  Step "validate" completed (34ms)                         │ │
│  │  14:25:00.050  Re-dispatched (invocation 2)                             │ │
│  │  14:25:00.062  Step "validate" — cached                                 │ │
│  │  14:25:00.063  Step "charge" started (has rollback)                     │ │
│  │  14:25:01.260  Step "charge" completed (1.2s)                           │ │
│  │  14:25:01.265  Re-dispatched (invocation 3)                             │ │
│  │  14:25:01.280  Step "validate" — cached                                 │ │
│  │  14:25:01.281  Step "charge" — cached                                   │ │
│  │  14:25:01.282  Step "warehouse-confirm" — waiting for signal            │ │
│  │  14:25:01.283  Heartbeat cleared, workflow suspended                    │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌ Details ────────────────────────────────────────────────────────────────┐ │
│  │  ID            a1b2c3d4-e5f6-7890-abcd-ef1234567890                    │ │
│  │  Status        waiting (signal: warehouse-confirm)                      │ │
│  │  Version       v2.0.0                                                   │ │
│  │  Priority      normal (2)                                               │ │
│  │  Invocations   3                                                        │ │
│  │  Steps         2 completed, 1 waiting                                   │ │
│  │  Heartbeat     — (suspended)                                            │ │
│  │  Key           order_abc-123                                            │ │
│  │  Started       Feb 9, 2026 14:25:00.000                                │ │
│  │  Deadline      Feb 9, 2026 15:25:00.000 (1h timeout)                   │ │
│  │  Parent        — (top-level)                                            │ │
│  │  Triggered by  system (cron)                                            │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Execution Detail — Failed with Compensation:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Workflows > Executions > wf-f4e5d6c7                                         │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  OrderWorkflows.processOrder                                    v2.0.0      │
│  ● failed  ·  Step "ship" failed  ·  Compensation complete                  │
│                                                                              │
│  ┌ Actions ────────────────────────────────────────────────────────────────┐ │
│  │  [ Retry Workflow ]    [ Retry Compensation ]                            │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌ Steps ──────────────────────────────────────────────────────────────────┐ │
│  │                                                                          │ │
│  │  #  STEP                 STATUS      DURATION  ATTEMPT                  │ │
│  │  ──────────────────────────────────────────────────────────────────────│ │
│  │  1  validate             ✓ done      34ms      1/1                     │ │
│  │  2  reserve-inventory    ✓ rolled ↩  89ms      1/1                     │ │
│  │     _rollback:reserve    ✓ done      45ms      — released inventory    │ │
│  │  3  charge-payment       ✓ rolled ↩  1.2s      1/4                     │ │
│  │     _rollback:charge     ✓ done      890ms     — refunded pay_123      │ │
│  │  4  ship                 ✕ failed    12.4s     4/4  (exhausted)        │ │
│  │                                                                          │ │
│  │  Compensation ran in reverse: charge → reserve                          │ │
│  │                                                                          │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌ Error ──────────────────────────────────────────────────────────────────┐ │
│  │  CarrierApiError: 503 Service Unavailable                               │ │
│  │    at ShippingService.createShipment (ShippingService.ts:42)            │ │
│  │    at OrderWorkflows.handler (OrderWorkflows.ts:38)                     │ │
│  │                                                                          │ │
│  │  Failed after 4 attempts (retried 3 times with exponential backoff)     │ │
│  │  Attempt 1: 503 Service Unavailable                                     │ │
│  │  Attempt 2: 503 Service Unavailable (after 2s)                          │ │
│  │  Attempt 3: 503 Service Unavailable (after 4s)                          │ │
│  │  Attempt 4: 503 Service Unavailable (after 8s)                          │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Execution Detail — Running with Heartbeat:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Workflows > Executions > wf-b2c3d4e5                                         │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  DataWorkflows.dailyEtl                                         (no ver.)   │
│  ● running  ·  4 completed, 3 running  ·  transform-file-005               │
│                                                                              │
│  ┌ Steps ──────────────────────────────────────────────────────────────────┐ │
│  │                                                                          │ │
│  │  ✓ extract              2.1s    { files: [{ id: "f01" }, ...] }        │ │
│  │  ✓ transform-f01        340ms   { rows: 1247 }                         │ │
│  │  ✓ transform-f02        280ms   { rows: 893 }                          │ │
│  │  ✓ transform-f03        510ms   { rows: 2104 }                         │ │
│  │  ● transform-f04        ...     running (attempt 1/1)                   │ │
│  │  ● transform-f05        ...     running (attempt 1/1)                   │ │
│  │  ● transform-f06        ...     running (attempt 1/1)                   │ │
│  │     (f04–f06 running in parallel via Promise.all)                       │ │
│  │                                                                          │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌ Details ────────────────────────────────────────────────────────────────┐ │
│  │  Heartbeat     ● alive (last: 3s ago, next: 27s)                       │ │
│  │  Invocations   5                                                        │ │
│  │  Steps         4 completed, 3 running                                   │ │
│  │  Cron          0 2 * * * (triggered at 02:00:00)                       │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

#### 9.3.5 Signals

Dedicated view for all pending and recent signals across workflows. Useful for operations teams monitoring human-in-the-loop workflows.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Workflows > Signals                                                          │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                      │
│  │  4            │  │  47          │  │  2           │                      │
│  │  Waiting      │  │  Received    │  │  Expired     │                      │
│  │  right now    │  │  today       │  │  today       │                      │
│  └──────────────┘  └──────────────┘  └──────────────┘                      │
│                                                                              │
│  Status: [All] [Waiting] [Received] [Expired]                               │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  STATUS   WORKFLOW                  SIGNAL             TIMEOUT  SINCE │  │
│  │  ──────────────────────────────────────────────────────────────────── │  │
│  │  ◐ wait   OrderWorkflows.process    warehouse-confirm  3h 42m   7m   │  │
│  │           wf-a1b2c3d4                                                 │  │
│  │           [ Send Signal ]                                             │  │
│  │                                                                        │  │
│  │  ◐ wait   ApprovalWorkflows.req     vote-0             47h 12m  48m  │  │
│  │           wf-c3d4e5f6                                                 │  │
│  │           [ Send Signal ]                                             │  │
│  │                                                                        │  │
│  │  ◐ wait   ApprovalWorkflows.req     vote-1             47h 12m  48m  │  │
│  │           wf-c3d4e5f6                                                 │  │
│  │           [ Send Signal ]                                             │  │
│  │                                                                        │  │
│  │  ◐ wait   OrderWorkflows.process    warehouse-confirm  1h 02m   3h   │  │
│  │           wf-d4e5f6a7                                                 │  │
│  │           [ Send Signal ]                                             │  │
│  │                                                                        │  │
│  │  ✓ recv   OrderWorkflows.process    warehouse-confirm  —        4h   │  │
│  │           wf-e5f6a7b8  ·  received 4h ago                             │  │
│  │                                                                        │  │
│  │  ✕ exp    ApprovalWorkflows.req     vote-2             —        26h  │  │
│  │           wf-a7b8c9d0  ·  expired 2h ago                              │  │
│  │                                                                        │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Inline Signal Send** — clicking "Send Signal" on a waiting signal expands an inline form:

```
│  ◐ wait   OrderWorkflows.process    warehouse-confirm  3h 42m   7m   │
│           wf-a1b2c3d4                                                 │
│           ┌──────────────────────────────────────────────────────┐   │
│           │  {                                                    │   │
│           │    "warehouseId": "",                                 │   │
│           │    "estimatedShipDate": ""                            │   │
│           │  }                                                    │   │
│           │  [ Send ]  [ Cancel ]                                 │   │
│           └──────────────────────────────────────────────────────┘   │
```

#### 9.3.6 Version History

Accessible from the Registry view by clicking a versioned workflow. Shows all versions, active execution counts, and allows draining old versions.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Workflows > Registry > OrderWorkflows.processOrder                           │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  VERSION   STATUS     ACTIVE RUNS   TOTAL RUNS   FIRST SEEN          │  │
│  │  ──────────────────────────────────────────────────────────────────── │  │
│  │  v2.0.0    current    3             87           Feb 8, 2026          │  │
│  │            handler: OrderWorkflows.ts:83                              │  │
│  │            changes: +fraud-check step, chargeV1 → chargeV2           │  │
│  │                                                                        │  │
│  │  v1.0.0    draining   2             1,247        Jan 15, 2026         │  │
│  │            handler: versions["1.0.0"]                                 │  │
│  │            2 active runs (oldest: wf-b2c3, started 27m ago)           │  │
│  │            Estimated drain: ~15 minutes                               │  │
│  │                                                                        │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  Step ID Diff (derived from execution history, not code analysis)            │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                                                                        │  │
│  │  v1.0.0                    v2.0.0                                     │  │
│  │  ─────                     ─────                                      │  │
│  │  validate                  validate          (in both)                │  │
│  │                          + fraud-check       (new in v2)              │  │
│  │  charge                    charge            (in both)                │  │
│  │  notify                    notify            (in both)                │  │
│  │                                                                        │  │
│  │  Note: diff is based on step IDs observed in completed executions.    │  │
│  │  It cannot detect logic changes within a step (same ID, different     │  │
│  │  behavior). For that, use commit history.                              │  │
│  │                                                                        │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 9.4 Navigation

The workflows section gets its own group in the admin sidebar, separate from Jobs:

```
┌──────────────┬──────────────────────────────────────────────────────────────┐
│  Admin       │                                                              │
│              │                                                              │
│  Dashboard   │                                                              │
│  Users       │                                                              │
│  Sessions    │                                                              │
│  API Keys    │                                                              │
│  Parameters  │                                                              │
│  Audits      │                                                              │
│  ─────────── │                                                              │
│  Jobs        │                                                              │
│   Dashboard  │                                                              │
│   Registry   │                                                              │
│   Executions │                                                              │
│   Cron       │                                                              │
│   Queue      │                                                              │
│  ─────────── │                                                              │
│  Workflows   │  ← own section                                               │
│   Dashboard  │                                                              │
│   Registry   │                                                              │
│   Executions │                                                              │
│   Signals    │                                                              │
│  ─────────── │                                                              │
│  Verif.      │                                                              │
│              │                                                              │
└──────────────┴──────────────────────────────────────────────────────────────┘
```

---

## 10. Complete Examples

### 10.1 Order Processing with Saga Compensation

```ts
import { $workflow } from "alepha/api/workflows"
import { $inject, $logger, t, AlephaError } from "alepha"

class OrderWorkflows {
  protected readonly orders = $inject(OrderService)
  protected readonly payments = $inject(PaymentService)
  protected readonly inventory = $inject(InventoryService)
  protected readonly shipping = $inject(ShippingService)
  protected readonly notifications = $inject(NotificationService)
  protected readonly log = $logger()

  processOrder = $workflow({
    schema: t.object({
      orderId: t.uuid(),
      userId: t.uuid(),
    }),

    timeout: [2, "hour"],
    concurrency: 20,

    handler: async ({ input, step }) => {
      // Validate
      const order = await step.run("validate", async () => {
        const o = await this.orders.getById(input.orderId)
        if (!o) throw new AlephaError("Order not found")
        return o
      })

      // Reserve inventory (with compensation)
      const reservation = await step.run("reserve-inventory", {
        run: async () => this.inventory.reserve(order.items),
        rollback: async (result) => {
          await this.inventory.release(result.reservationId)
          this.log.info("Inventory released", { reservationId: result.reservationId })
        },
      })

      // Charge payment (with compensation + retry)
      const payment = await step.run("charge-payment", {
        run: async () => this.payments.charge({
          userId: input.userId,
          amount: order.total,
          orderId: order.id,
        }),
        rollback: async (result) => {
          await this.payments.refund(result.paymentId)
          this.log.info("Payment refunded", { paymentId: result.paymentId })
        },
        retry: { retries: 3, backoff: { initial: [2, "second"], factor: 2 } },
      })

      // Ship and generate invoice in parallel
      const [tracking, invoice] = await Promise.all([
        step.run("ship", async () => this.shipping.createShipment(order, reservation)),
        step.run("invoice", async () => this.billing.createInvoice(order, payment)),
      ])

      // Notify customer
      await step.run("notify", async () => {
        await this.notifications.send(input.userId, {
          type: "order_shipped",
          trackingId: tracking.id,
          invoiceId: invoice.id,
        })
      })

      // Wait a day, then send follow-up
      await step.sleep("follow-up-delay", [24, "hour"])

      await step.run("follow-up", async () => {
        await this.notifications.sendFollowUp(input.userId, {
          orderId: order.id,
          trackingId: tracking.id,
        })
      })

      return { paymentId: payment.paymentId, trackingId: tracking.id }
    },
  })
}
```

### 10.2 Multi-Approver Workflow with Signals

```ts
class ApprovalWorkflows {
  protected readonly approvals = $inject(ApprovalService)
  protected readonly notifications = $inject(NotificationService)
  protected readonly log = $logger()

  requestApproval = $workflow({
    schema: t.object({
      requestId: t.uuid(),
      approverIds: t.array(t.uuid()),
      requiredApprovals: t.integer(),
    }),

    timeout: [7, "day"],

    handler: async ({ input, step }) => {
      // Notify all approvers
      await step.run("notify-approvers", async () => {
        await this.notifications.notifyAll(input.requestId, input.approverIds)
      })

      // Collect approvals one at a time
      let approved = 0
      let rejected = 0
      const threshold = input.requiredApprovals
      const total = input.approverIds.length

      for (let i = 0; i < total; i++) {
        const response = await step.waitFor(`vote-${i}`, {
          timeout: [48, "hour"],
        })

        if (response.data.approved) approved++
        else rejected++

        // Early exit: enough approvals or mathematically impossible
        if (approved >= threshold) break
        if (rejected > total - threshold) break
      }

      const isApproved = approved >= threshold

      await step.run("finalize", async () => {
        await this.approvals.finalize(input.requestId, {
          approved: isApproved,
          approvedCount: approved,
          rejectedCount: rejected,
        })
      })

      return { approved: isApproved, approvedCount: approved, rejectedCount: rejected }
    },
  })
}
```

### 10.3 ETL Pipeline (Cron-Triggered)

```ts
class DataWorkflows {
  protected readonly extractor = $inject(DataExtractor)
  protected readonly transformer = $inject(DataTransformer)
  protected readonly loader = $inject(DataLoader)
  protected readonly log = $logger()

  dailyEtl = $workflow({
    cron: "0 2 * * *",                         // every day at 02:00
    lock: true,
    timeout: [4, "hour"],

    handler: async ({ step }) => {
      // Extract
      const files = await step.run("extract", async () => {
        return this.extractor.fetchDailyData()
      })

      // Safe between steps: logging is pure (re-executes on replay, but harmless)
      this.log.info(`Extracted ${files.length} files`)

      // Transform in parallel
      const results = await Promise.all(
        files.map((file) =>
          step.run(`transform-${file.id}`, async () => this.transformer.process(file)),
        ),
      )

      // Load
      const stats = await step.run("load", async () => {
        return this.loader.bulkInsert(results)
      })

      return { filesProcessed: files.length, rowsInserted: stats.rows }
    },
  })
}
```

### 10.4 User Onboarding with Child Workflow

```ts
class OnboardingWorkflows {
  protected readonly users = $inject(UserService)
  protected readonly teams = $inject(TeamService)
  protected readonly log = $logger()

  onboardUser = $workflow({
    schema: t.object({
      userId: t.uuid(),
      teamId: t.uuid(),
    }),

    handler: async ({ input, step }) => {
      // Setup user profile
      const profile = await step.run("setup-profile", async () => {
        return this.users.setupProfile(input.userId)
      })

      // Run team provisioning as a child workflow
      const teamResult = await step.invoke(
        "provision-team",
        this.provisionTeam,
        { userId: input.userId, teamId: input.teamId },
      )

      // Send welcome email after 5 minutes (let systems propagate)
      await step.sleep("welcome-delay", [5, "minute"])

      await step.run("welcome-email", async () => {
        await this.notifications.sendWelcome(input.userId, {
          teamName: teamResult.teamName,
          dashboardUrl: profile.dashboardUrl,
        })
      })

      return { profileId: profile.id, teamName: teamResult.teamName }
    },
  })

  provisionTeam = $workflow({
    schema: t.object({
      userId: t.uuid(),
      teamId: t.uuid(),
    }),

    handler: async ({ input, step }) => {
      const team = await step.run("fetch-team", async () => {
        return this.teams.getById(input.teamId)
      })

      await step.run("add-member", async () => {
        await this.teams.addMember(input.teamId, input.userId)
      })

      await step.run("grant-access", async () => {
        await this.teams.grantDefaultAccess(input.teamId, input.userId)
      })

      return { teamName: team.name }
    },
  })
}
```

---

## 11. Testing

Workflows are fully testable using Alepha's DI system. No `vi.mock()` — use `.with()` substitution and `MemoryQueueProvider`.

### 11.1 Full Workflow Test

```ts
test("processOrder workflow completes end-to-end", async ({ expect }) => {
  const alepha = Alepha.create()
    .with({ provide: PaymentService, use: MemoryPaymentService })
    .with({ provide: ShippingService, use: MemoryShippingService })
    .with({ provide: NotificationService, use: MemoryNotificationService })

  const workflows = alepha.inject(OrderWorkflows)
  const provider = alepha.inject(WorkflowProvider)

  const { workflowId } = await workflows.processOrder.start({
    orderId: "test-123",
    userId: "user-456",
  })

  // drain() runs all invocations synchronously without the job queue.
  // Each invocation executes Phase 1 + Phase 2 in a loop until the handler completes.
  await provider.drain(workflowId)

  const status = await provider.getStatus(workflowId)
  expect(status.status).toBe("completed")
  expect(status.output).toEqual({
    trackingId: expect.any(String),
    invoiceId: expect.any(String),
  })
})
```

`WorkflowProvider.drain(workflowId)` is a **test-only** method. It runs all invocations synchronously in a loop — Phase 1 (plan), Phase 2 (execute), re-invoke — until the handler returns or suspends on a signal. This makes tests fast and deterministic with no real timers or job queue processing.

### 11.2 Testing Signals

```ts
test("workflow waits for signal and resumes", async ({ expect }) => {
  const alepha = Alepha.create()
  const workflows = alepha.inject(OrderWorkflows)
  const provider = alepha.inject(WorkflowProvider)

  const { workflowId } = await workflows.processOrder.start(input)

  // Drain until the workflow suspends on a signal
  await provider.drain(workflowId)
  const status = await provider.getStatus(workflowId)
  expect(status.status).toBe("waiting")

  // Send the signal
  await workflows.processOrder.signal(workflowId, "warehouse-confirm", {
    warehouseId: "wh-01",
    estimatedShipDate: "2026-02-15",
  })

  // Drain the rest
  await provider.drain(workflowId)
  expect((await provider.getStatus(workflowId)).status).toBe("completed")
})
```

### 11.3 Testing Compensation

```ts
test("workflow compensates on failure", async ({ expect }) => {
  const alepha = Alepha.create()
    .with({
      provide: ShippingService,
      use: class FailingShipping extends ShippingService {
        public async createShipment() {
          throw new AlephaError("Carrier API down")
        }
      },
    })

  const workflows = alepha.inject(OrderWorkflows)
  const provider = alepha.inject(WorkflowProvider)
  const payments = alepha.inject(MemoryPaymentService)

  const { workflowId } = await workflows.processOrder.start(input)
  await provider.drain(workflowId)

  const status = await provider.getStatus(workflowId)
  expect(status.status).toBe("failed")

  // Verify compensation ran — payment was refunded
  expect(payments.wasRefunded("pay_123")).toBe(true)
})
```

### 11.4 Testing with `step.sleep`

`drain()` treats `step.sleep` as immediately completed in test mode — no real delay. The sleep step is cached and the next invocation proceeds instantly.

```ts
test("workflow with sleep completes", async ({ expect }) => {
  const { workflowId } = await workflows.onboardUser.start(input)
  await provider.drain(workflowId) // sleep("welcome-delay", [5, "minute"]) → instant
  expect((await provider.getStatus(workflowId)).status).toBe("completed")
})
```

---

## 12. Decisions

1. **Execution model: step-at-a-time (Inngest/OpenWorkflow), not coroutines (Temporal).** The handler is re-invoked for each step. Simpler runtime — no coroutine serialization, no deterministic replay constraints beyond step IDs. Trade-off: small replay overhead per invocation (mitigated by in-memory memoization).

2. **Step IDs, not positional ordering.** Steps are memoized by user-provided string ID, not execution order. This allows conditional logic, loops, and dynamic step counts without replay hazards. Trade-off: user must provide unique, deterministic IDs.

3. **Built on $job, not parallel to it.** Workflow invocations are dispatched as `$job` executions. Reuses all of `$job`'s infrastructure: queue backends, retry, scheduling, concurrency, graceful shutdown, admin UI. No new queue layer, no new polling loops.

4. **`Promise.all` for parallel, not a custom primitive.** Parallel execution uses native `Promise.all` with multiple `step.run` calls. Each step is independently memoized — the framework naturally handles cached vs new steps. No `step.parallel()` API needed. This is the same approach as OpenWorkflow — standard JavaScript concurrency is the parallel primitive. Less API surface, zero learning curve.

5. **Saga compensation built-in.** The `rollback` option on `step.run()` enables saga-pattern compensation as a first-class feature. Compensation runs in reverse order automatically on failure or cancellation. This is the primary reason users need workflows over plain job chaining.

6. **Signals over polling.** External events use a signal mechanism (persist + re-dispatch) rather than HTTP callbacks or polling. Signals are buffered — they can arrive before the workflow reaches `waitFor`. No timing races.

7. **Separate entities from $job.** Workflows have their own tables (`workflow_executions`, `workflow_steps`, `workflow_signals`). The data model is different enough that overloading `job_executions` would require awkward nullable columns and ambiguous queries. The internal `$job` executions (invocations) still use `job_executions` — they're the dispatch mechanism, not the workflow state.

8. **Child workflows, not nested step groups.** Composition uses independent child workflows with their own lifecycle, cancellation cascade, and retry policies. This keeps the step model flat. A child workflow can be reused across multiple parent workflows.

9. **No visual workflow builder.** Workflows are code. The admin UI shows execution state and step progress, but definitions live in TypeScript. This matches Alepha's code-first philosophy.

10. **Max invocations safety limit.** To prevent infinite loops from buggy step ID generation, workflows are capped at `maxInvocations` (default: 1000). If reached, the workflow fails with `WorkflowInvocationLimitError`. This is a safety net, not a design constraint — real workflows rarely exceed 50 invocations.

11. **Retry at step level, not workflow level.** When a step fails, only that step retries (with backoff, across invocations). The workflow doesn't restart from the beginning. Completed steps are cached and never re-executed. This is more efficient and predictable than workflow-level retry.

12. **Versioning for safe deploys.** Inspired by OpenWorkflow. The `version` field is recorded on the execution at start time. Multiple handler implementations can coexist — old runs continue with the version they started on, new runs use the latest. This eliminates the need to drain workflows before deploying breaking changes. The `versions` map keeps old handlers available for in-flight executions.

13. **Heartbeat-based crash recovery.** Inspired by OpenWorkflow. Workers periodically extend a `heartbeatAt` timestamp on the execution. On crash, the heartbeat stops and the sweep detects it within 30-60 seconds. This is much faster than the `$job` recovery sweep's 5-minute stale threshold. The `$job` sweep remains as a safety net. The heartbeat mechanism never modifies step state — it only triggers re-dispatch.

14. **Internal job isolation.** Workflow invocations create `job_executions` records marked `internal: true`. The jobs admin dashboard filters these out by default (with a toggle to show). This prevents high-throughput workflows from drowning out "real" application jobs in the jobs UI. Workflow invocations are visible in the dedicated workflows admin instead.
