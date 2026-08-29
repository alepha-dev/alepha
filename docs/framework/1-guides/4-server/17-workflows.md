# Workflows

`$workflow` is for a business process that has more than one step and must
survive the process dying halfway through. Steps run in order, each step's
result is written to the database before the next one starts, and a failure
either unwinds the completed steps or stops the execution where it stands.

```typescript check
import { $workflow } from "alepha/api/workflows";
```

It builds on the job outbox and a distributed lock, so it is registered as a
module:

```typescript
import { AlephaApiWorkflows } from "alepha/api/workflows";

alepha.with(AlephaApiWorkflows);
```

## When this rather than `$job`

A `$job` is one unit of work: push it, it runs, it retries, it is done. Reach
for `$workflow` when the work has _joints_ - places where you want to know that
step three succeeded and step four has not started yet.

That distinction pays for itself in three situations:

- **A crash must not redo the whole thing.** After a restart, an execution
  resumes at the step that was pending, not at the beginning. Charging a card
  twice because the email server was slow is the failure this prevents.
- **A late failure must undo earlier success.** Reserve stock, charge the card,
  book the courier: if the courier refuses, the charge has to come back. That is
  the saga pattern, and it is the default.
- **The process waits.** "Send a reminder 24 hours later" is not a step that
  sleeps, it is a step that is parked in the database with a due date.

If none of those apply, a `$job` is the smaller tool and the right one.

## Declaring one

```typescript check
import { z } from "alepha";
import { $workflow } from "alepha/api/workflows";

class Orders {
  fulfil = $workflow({
    schema: z.object({ orderId: z.uuid() }),
    steps: [
      {
        name: "reserveStock",
        handler: async ({ payload }) => {
          return { reservationId: `res-${payload.orderId}` };
        },
      },
      {
        name: "charge",
        handler: async ({ results }) => {
          const stock = results.reserveStock as { reservationId: string };
          return { chargeId: `ch-${stock.reservationId}` };
        },
      },
    ],
  });
}
```

`schema` types the payload. Each step returns a value, and that value is
persisted and handed to every later step in `results`, keyed by step name. A
step that returns nothing still records that it ran.

Start it and you get an execution id back:

```typescript
const executionId = await this.fulfil.start({ orderId });
```

`start()` returns as soon as the execution row exists. The steps run through the
job outbox, not inline, so the caller is not holding a request open while a
courier API decides.

### Every handler must be idempotent

This is the one rule the engine cannot enforce for you. Crash recovery replays
the last unacknowledged unit of work, which means a step that crashed _after_
its side effect but _before_ its result was written will run again. So will a
`when()` guard, and so will a compensation handler.

In practice: pass an idempotency key to whatever you call, or check whether the
effect already happened before doing it.

## Failure: compensate or fail

The default is `onError: "compensate"`. When a step throws and its retries are
exhausted, every step that already completed runs its `compensate` handler, in
reverse order:

```typescript check
import { z } from "alepha";
import { $workflow } from "alepha/api/workflows";

class Orders {
  fulfil = $workflow({
    schema: z.object({ orderId: z.uuid() }),
    onError: "compensate",
    steps: [
      {
        name: "charge",
        handler: async ({ payload }) => ({ chargeId: payload.orderId }),
        compensate: async ({ result }) => {
          const charge = result as { chargeId: string };
          await Promise.resolve(charge.chargeId);
        },
      },
      {
        name: "book",
        handler: async () => {
          throw new Error("courier refused");
        },
      },
    ],
  });
}
```

`compensate` receives that step's own `result`, so it knows what to undo without
looking it up. It does not run for the step that failed: that step did not
complete, so there is nothing of its own to reverse.

`onError: "fail"` skips all of it and marks the execution failed. Use it when
the steps are independent enough that a half-finished run is a state a human
should look at rather than one the machine should unwind.

## Retries, timeouts and conditions

Per step:

```typescript check
import { z } from "alepha";
import { $workflow } from "alepha/api/workflows";

class Orders {
  fulfil = $workflow({
    schema: z.object({ orderId: z.uuid(), express: z.boolean() }),
    timeout: [1, "hour"],
    steps: [
      {
        name: "book",
        timeout: [30, "seconds"],
        retry: {
          retries: 5,
          backoff: { initial: [2, "seconds"], factor: 2, jitter: true },
          when: (error) => !error.message.includes("invalid address"),
        },
        when: ({ payload }) => payload.express,
        handler: async () => ({ booked: true }),
      },
    ],
  });
}
```

| Option          | Scope    | Effect                                                        |
| --------------- | -------- | ------------------------------------------------------------- |
| `retry.retries` | step     | How many attempts before the step is considered failed        |
| `retry.backoff` | step     | Fixed duration, or `{ initial, factor, max, jitter }`         |
| `retry.when`    | step     | Return `false` to give up immediately on an unretryable error |
| `timeout`       | step     | Deadline for one attempt                                      |
| `timeout`       | workflow | Deadline for the whole execution                              |
| `when`          | step     | Skip the step when it returns `false`                         |

Retries go through the job outbox, so a retry scheduled two seconds before the
process died still fires after it comes back.

## Waiting: `delay` and `repeat`

`delay` parks a step until a moment in the future, counted from when the
previous step finished:

```typescript
{
  name: "reminder",
  delay: [24, "hours"],
  handler: async ({ payload }) => this.email.send(payload.orderId),
}
```

The wait is persisted as the step's `scheduledAt` before any timer is armed. The
timer only improves latency; the recovery sweep re-dispatches anything due from
the database alone, so a 24 hour wait survives every deploy in between.

`repeat` makes a step run itself again. The handler resolving with
`{ repeat: true }` re-parks the same step after `delay`; any other resolution is
the step's final result and the workflow moves on:

```typescript check
import { z } from "alepha";
import { $workflow } from "alepha/api/workflows";

class Shifts {
  offer = $workflow({
    schema: z.object({ shiftId: z.uuid(), candidates: z.array(z.uuid()) }),
    steps: [
      {
        name: "offerToNextCandidate",
        repeat: { delay: [10, "minutes"], limit: 20 },
        handler: async ({ payload, context }) => {
          const candidate = payload.candidates[context.iteration];
          if (!candidate) {
            return { filled: false };
          }
          const accepted = await Promise.resolve(false);
          return accepted ? { filled: true, candidate } : { repeat: true };
        },
      },
    ],
  });
}
```

`context.iteration` is the zero-based round counter, and it is `0` for every
step that does not repeat. `limit` caps the total number of runs; a handler
still asking to repeat after the last one fails the step, and normal `onError`
handling takes over.

The retry budget resets on each iteration, which is what you want (a transient
failure in round 7 should not be counted against round 8) and is also why
iteration handlers have to be idempotent: a crash between the verdict and the
re-park replays the same round.

## Deduplication and fan-out

`key` makes a start idempotent: while an execution is live under that key, a
second `start()` with the same key returns the existing execution instead of a
new one.

```typescript
await this.fulfil.start({ orderId }, { key: `order:${orderId}` });
```

The uniqueness only spans live statuses, so once an execution reaches a terminal
state its key is free again. That is deliberate (an order can be fulfilled twice
over its lifetime) and it is why you should not treat a key as a permanent
handle: look executions up by key _or_ payload.

`startEach` is the same idea over a list:

```typescript
await this.fulfil.startEach(orders, (order) => ({
  payload: { orderId: order.id },
  key: `order:${order.id}`,
}));
```

Each item gets its own execution, its own retry budget, its own logs and its own
admin row. The trade against one step looping over the whole list is more rows
in exchange for per-item granularity, and re-drivability: run it again after a
partial failure and only the missing items start.

## Controlling a running execution

| Call                   | Does                                                          |
| ---------------------- | ------------------------------------------------------------- |
| `status(executionId)`  | Reads the execution row                                       |
| `cancel(executionId)`  | Stops it; pass `{ compensate: true }` to unwind first         |
| `cancelByKey(key)`     | Cancels whatever is live under a dedup key, `null` if nothing |
| `retry(executionId)`   | Resumes a failed execution from the step that failed          |
| `restart(executionId)` | Starts a fresh execution from the beginning                   |

`cancelByKey` is what a "the customer replied, stop the reminder cascade"
listener wants: it does not need to have kept the execution id anywhere.

## Carrying context across steps

Steps run on whatever process the outbox hands them to, which is not
necessarily the one that called `start()`. Anything held in an async-local
context is therefore gone by the time a step runs.

`context` names the atoms to capture at start and restore around every step,
`when()` and compensation handler:

```typescript
fulfil = $workflow({
  schema: z.object({ orderId: z.uuid() }),
  context: [currentTenantAtom],
  steps: [/* ... */],
});
```

Tenancy is the canonical case: each step runs under the tenant that started the
execution, with no tenant id hand-carried through the payload and no chance of a
recovery-sweep dispatch running against the wrong one. The values are persisted
with the execution, so they must survive a JSON round trip.

## Observing

The module declares a hook for every transition: `workflow:started`,
`workflow:step:begin`, `workflow:step:completed`, `workflow:step:failed`,
`workflow:step:skipped`, `workflow:step:repeat`, `workflow:completed`,
`workflow:failed`, `workflow:compensating`, `workflow:compensated`,
`workflow:compensation:failed`, `workflow:cancelled` and `workflow:timed_out`.

```typescript
alepha.events.on(
  "workflow:step:failed",
  ({ workflowName, stepName, error }) => {
    // ship it to your error tracker
  },
);
```

`AdminWorkflowController` exposes executions, their steps and their captured
logs. One caveat: admin action names are global across the app, so a second
controller exporting an action called `getExecution` collides at boot rather
than at typecheck.

## Testing

`WorkflowTestKit` exists because testing a durable engine with a frozen clock
has two traps in it, and both produce a hanging test rather than a failing one.

```typescript
const kit = alepha.inject(WorkflowTestKit);

const executionId = await app.fulfil.start({ orderId });
await kit.awaitParked(executionId, "reminder");
await dateTime.travel([25, "hours"]);
await kit.awaitStatus(executionId, "completed");
```

- **Park before you travel.** `awaitParked` waits for the next step to be
  pending _with its `scheduledAt` stamp written_. Travelling before that stamp
  exists means the timer was never born and nothing will ever fire it.
- **Nudge the sweep afterwards.** Once the clock is frozen no cron ticks again on
  its own, so polling for a status has to drive the recovery sweep. `settle` and
  `awaitStatus` do that for you.

`findByPayload` finds executions that were started without a key.

## See also

- [Background Jobs](/docs/guides-server-background-jobs) is the outbox
  underneath, and the right tool for single-step work
- [Unit Tests](/docs/guides-testing-unit-tests) for `travel()` and the container
  lifecycle in tests
