# $realm

## Import

```typescript
import { $realm } from "alepha/api/users";
```

## Overview

Already configured realm for user management.

Realm contains two roles: `admin` and `user`.

- `admin`: Has full access to all resources and permissions.
- `user`: Has access to their own resources and permissions, but cannot access admin-level resources.

Realm uses session management for handling user sessions.

Environment Variables:
- `APP_SECRET`: Secret key for signing tokens (if not provided in options).

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `secret` | `string` | No | Secret key for signing tokens |
| `issuer` | `Partial&lt;IssuerPrimitiveOptions&gt;` | No | Issuer configuration options |
| `entities` | `Object` | No | Override entities. |
| `users` | `Repository&lt;typeof users.schema&gt;` | No |  |
| `identities` | `Repository&lt;typeof identities.schema&gt;` | No |  |
| `sessions` | `Repository&lt;typeof sessions.schema&gt;` | No |  |
| `settings` | `Partial&lt;RealmAuthSettings&gt;` | No |  |
| `identities` | `Object` | No |  |
| `credentials` | `true` | No |  |
| `google` | `true` | No |  |
| `github` | `true` | No |  |
| `apple` | `true` | No |  |
| `facebook` | `true` | No |  |
| `microsoft` | `true` | No |  |
| `franceconnect` | `true` | No |  |
| `features` | `Partial&lt;RealmFeatures&gt;` | No | Enable or disable realm features |

