# Alepha - Api Users

## Installation

Part of the `alepha` package. Import from `alepha/api/users`.

```bash
npm install alepha
```

## Overview

| type | quality | stability |
|------|---------|-----------|
| backend | epic | stable |

Complete user management with multi-realm support for multi-tenant applications.

**Features:**
- User registration, login, and profile management
- Password reset workflows
- Email verification
- Session management with multiple devices
- Identity management (social logins, SSO)
- Multi-realm support for tenant isolation
- Credential management
- Entities: `users`, `identities`, `sessions`

## API Reference

### Primitives

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $realm()

Already configured realm for user management.

Realm contains two roles: `admin` and `user`.

- `admin`: Has full access to all resources and permissions.
- `user`: Has access to their own resources and permissions, but cannot access admin-level resources.

Realm uses session management for handling user sessions.

Environment Variables:
- `APP_SECRET`: Secret key for signing tokens (if not provided in options).
