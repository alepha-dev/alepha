# @alepha/ui - Admin

## Installation

```bash
npm install @alepha/ui
```

## Overview

Generic admin UI framework.

Provides the admin layout shell, `$uiAdmin` primitive for explicit
page composition, and shared components for building admin pages.

Domain-specific admin pages are provided by sub-modules:
- `@alepha/ui/admin-users`
- `@alepha/ui/admin-sessions`
- `@alepha/ui/admin-audits`
- `@alepha/ui/admin-files`
- `@alepha/ui/admin-parameters`
- `@alepha/ui/admin-jobs`
- `@alepha/ui/admin-keys`
- `@alepha/ui/admin-notifications`
- `@alepha/ui/admin-billing`

## API Reference

### Primitives

- [`$uiAdmin`](/docs/reference-primitives-$uiadmin) — Create an admin panel with explicit page composition and sidebar configuration.
