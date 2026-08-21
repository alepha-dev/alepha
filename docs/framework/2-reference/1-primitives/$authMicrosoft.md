# $authMicrosoft

## Import

```typescript
import { $authMicrosoft } from "alepha/server/auth";
```

## Overview

Already configured Microsoft Entra ID (Azure AD) authentication primitive.

Uses OpenID Connect (OIDC) to authenticate users via their Microsoft accounts.
Supports personal Microsoft accounts, work/school (Azure AD) accounts, and
multi-tenant applications.

The tenant ID defaults to `"common"`, which allows all Microsoft account types
(personal, work, school). To restrict to a specific Azure AD tenant, set
`MICROSOFT_TENANT_ID` to your tenant's GUID or domain.

**Note on multi-tenant issuer validation**: Microsoft's OIDC discovery document
for the `common` endpoint returns `{tenantid}` as a literal placeholder in the
`issuer` field. This is expected behavior for multi-tenant endpoints. The
openid-client library handles this during token validation automatically.

Environment Variables:

- `MICROSOFT_CLIENT_ID`: The application (client) ID from the Azure Portal.
- `MICROSOFT_CLIENT_SECRET`: The client secret value from the Azure Portal.
- `MICROSOFT_TENANT_ID`: (Optional) Azure AD tenant ID or `"common"` for
  multi-tenant. Defaults to `"common"`.
