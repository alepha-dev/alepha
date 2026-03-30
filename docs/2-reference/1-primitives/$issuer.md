# $issuer

## Import

```typescript
import { $issuer } from "alepha/security";
```

## Overview

Create a new issuer.

An issuer is responsible for creating and verifying JWT tokens.
It can be internal (with a secret) or external (with a JWKS).

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | `string` | No | Define the issuer name |
| `description` | `string` | No | Short description about the issuer. |
| `roles` | `Array&lt;string \| Role&gt;` | No | All roles available in the issuer |
| `settings` | `IssuerSettings` | No | Issuer settings. |
| `profile` | `Object` | No | Parse the JWT payload to create a user account info. |
| `resolvers` | `IssuerResolver[]` | No | Custom resolvers (in addition to default JWT resolver). |

