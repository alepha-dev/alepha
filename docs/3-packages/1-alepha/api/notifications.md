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
- Queue-based delivery with retry and audit trail (`record: "all"` + no ring buffer trim)
- Runtime-editable retention window via `$parameter` — purge cron respects it live
- Admin API for inspecting sent notifications

## API Reference

### Primitives

- [`$notification`](/docs/reference-primitives-$notification) — Creates a notification primitive for managing email/SMS notification templates.
