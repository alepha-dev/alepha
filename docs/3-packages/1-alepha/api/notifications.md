# Alepha - Api Notifications

## Installation

Part of the `alepha` package. Import from `alepha/api/notifications`.

```bash
npm install alepha
```

## Overview

User notification management.

**Features:**
- Notification definitions (email/SMS templates)
- Delivery via `$job` with retry and audit trail (`record: "all"` + no ring buffer trim)
- Runtime-editable retention window via `$parameter` — purge cron respects it live
- Admin API for inspecting sent notifications

**Delivery mode** is decided at runtime by the `$job` system:
- If your app loads `AlephaApiJobsQueue` (and thus `AlephaQueue`), notifications
  go through the queue (best for high-volume systems).
- Otherwise, notifications run in **direct** mode: pushed to the outbox table
  and processed in the same process right after the HTTP response is returned.
  The reconciliation sweep is the safety net for crashes / retries.

Direct mode is the recommended default for small / cheap deployments
(Cloudflare Workers, single-instance Node) — no queue infrastructure required.

## API Reference

### Primitives

- [`$notification`](/docs/reference-primitives-$notification) — Creates a notification primitive for managing email/SMS notification templates.
