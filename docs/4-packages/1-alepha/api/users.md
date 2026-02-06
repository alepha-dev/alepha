# Alepha - Api Users

## Installation

Part of the `alepha` package. Import from `alepha/api/users`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.5.0 | node, bun, workerd|

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

- [`$realm`](/docs/primitives-$realm) — Already configured realm for user management.
