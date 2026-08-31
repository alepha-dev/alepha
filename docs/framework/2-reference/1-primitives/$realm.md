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

| Option            | Type                                    | Required | Description                                                                                                                               |
| ----------------- | --------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `secret`          | `string`                                | No       | Secret key for signing tokens                                                                                                             |
| `signing`         | `SigningConfig`                         | No       | Asymmetric signing config for this realm's tokens (OIDC provider mode)                                                                    |
| `issuer`          | `Partial&lt;IssuerPrimitiveOptions&gt;` | No       | Issuer configuration options                                                                                                              |
| `entities`        | `Object`                                | No       | Override entities.                                                                                                                        |
| `settings`        | `Partial&lt;RealmAuthSettings&gt;`      | No       |                                                                                                                                           |
| `isPreAuthorized` | `RegistrationPreAuthorizationFn`        | No       | Let SPECIFIC addresses register while `settings.registrationAllowed` is `false`, instead of the realm being open to everyone or to nobody |
| `identities`      | `Object`                                | No       |                                                                                                                                           |
| `features`        | `Partial&lt;RealmFeatures&gt;`          | No       | Enable or disable realm features                                                                                                          |
