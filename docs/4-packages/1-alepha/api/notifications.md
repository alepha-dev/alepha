# Alepha - Api Notifications

## Installation

Part of the `alepha` package. Import from `alepha/api/notifications`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.10.0 | node, bun, workerd|

User notification management.

**Features:**
- Notification definitions
- Email/SMS notification sending
- Job-based delivery with retry and tracking
- User preferences

## API Reference

### Primitives

- [`$notification`](/docs/reference-primitives-$notification) — Creates a notification primitive for managing email/SMS notification templates.
