# $uiAdmin

## Import

```typescript
import { $uiAdmin } from "@alepha/ui/admin";
```

## Overview

Create an admin panel with explicit page composition and sidebar configuration.

Pages listed in `pages` are parented under the admin layout (`/admin`).
Sidebar items that reference a `$page` are resolved to `SidebarNode` objects.

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `pages` | `PagePrimitive[]` | Yes | Root pages to parent under the admin layout |
| `sidebarItems` | `AdminSidebarItem[]` | Yes | Sidebar navigation items |
| `appBarItems` | `AppBarItem[]` | No | AppBar items displayed in the admin header. |
| `shellProps` | `Partial&lt;DashboardShellProps&gt;` | No | Additional DashboardShell props for the admin layout. |

