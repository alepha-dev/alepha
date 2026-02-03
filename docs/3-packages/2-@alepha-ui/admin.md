# @alepha/ui - Admin

## Installation

```bash
npm install @alepha/ui
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 2 - beta | 0.12.0 | node, bun, workerd, browser|

Admin panel UI components.

**Features:**
- AdminLayout for admin pages
- AdminUsers with user list, create, details, settings, sessions, audits
- AdminFiles for file management
- AdminJobs for job monitoring
- AdminNotifications for notification management
- AdminParameters for configuration management
- AdminSessions for session management
- AdminAudits for audit log viewing
- AdminVerifications for verification management

## API Reference

### Primitives

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $uiAdmin()

Register Admin UI components and get the AdminRouter instance.
