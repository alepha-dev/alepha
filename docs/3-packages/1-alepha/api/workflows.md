# Alepha - Api Workflows

## Installation

Part of the `alepha` package. Import from `alepha/api/workflows`.

```bash
npm install alepha
```

## Overview

Durable workflow engine for long-running business processes.

**Features:**
- Declarative, multi-step workflows with typed payloads
- Saga-pattern compensation for failure recovery
- Per-step retry with exponential backoff, delivered through the job
  outbox — a retry scheduled before a crash still fires after it
- Durable delayed steps (`delay` on a step) and delayed starts, for
  sequences like "send a reminder after 24h"
- Durable loops (`repeat` on a step): the handler resolves
  `{ repeat: true }` to run the same step again after a persisted wait,
  with `context.iteration` as the round counter — offer/claim cascades
  without self-chaining workflows
- Context propagation (`context: [someAtom]`): atom values captured at
  `start()` follow the execution to whatever process runs each step,
  `when()` guard, or compensation — the canonical use is tenancy
- Workflow-level timeout and cancellation, including `cancelByKey` for
  disarm-style listeners
- Deduplication via unique keys (race-safe: backed by a partial unique
  index) and `startEach` for re-drivable per-item fan-out
- Per-execution log capture

Every wait is persisted (`scheduledAt` on the step row) before any
timer is armed: timers and queue deliveries only optimize latency,
the recovery sweep re-dispatches anything due from the DB alone.

**Sharp edges, learned by dogfooding:**
- Dedup keys are kept on terminal rows — the partial unique index only
  spans live statuses, so a finished key can be re-used by a new run.
  Look executions up by key or payload; `WorkflowTestKit.findByPayload`
  works for unkeyed workflows too.
- Admin action names are app-global. Two controllers exporting an
  action named `getExecution` collide at boot, not at typecheck.
- Step, `when()` and compensation handlers should be idempotent: crash
  recovery replays the last unacknowledged unit of work.
- Testing with `travel()`: park before travel (wait for the next step
  to be pending WITH its `scheduledAt` stamp), and nudge the recovery
  sweep while polling afterwards — the post-travel clock is frozen, so
  no cron ever ticks again on its own. `WorkflowTestKit` packages both
  disciplines (`awaitParked`, `settle`, `awaitStatus`).

## API Reference

### Primitives

- [`$workflow`](/docs/reference-primitives-$workflow) — Declare a durable, multi-step workflow (saga).

### Providers

- [`WorkflowProvider`](/docs/reference-providers-workflowprovider) — The workflow engine: persists executions and step state, dispatches
