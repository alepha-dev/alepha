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
- Workflow-level timeout and cancellation
- Deduplication via unique keys (race-safe: backed by a partial unique
  index)
- Per-execution log capture

Every wait is persisted (`scheduledAt` on the step row) before any
timer is armed: timers and queue deliveries only optimize latency,
the recovery sweep re-dispatches anything due from the DB alone.

## API Reference

### Primitives

- [`$workflow`](/docs/reference-primitives-$workflow) — Declare a durable, multi-step workflow (saga).

### Providers

- [`WorkflowProvider`](/docs/reference-providers-workflowprovider) — The workflow engine: persists executions and step state, dispatches
