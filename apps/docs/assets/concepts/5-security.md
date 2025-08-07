## Alepha Security Concepts

This document outlines the core security concepts of Alepha, including authentication, authorization, session management, and token handling.

---

### 🛡️ Authorization

#### `$permission()`

A **permission** is a specific action a user can perform inside your application.

* Created automatically by `$action()`
* Not persisted (neither in DB nor in token)

```ts
const readOrders = $permission("read:orders");
```

---

#### `$role()`

A **role** is a collection of permissions.

```ts
const admin = $role({
  permissions: [{ name: "*" }]
});

const user = $role({
  permissions: [{ name: "read:orders", ownership: "self" }]
});
```

---

#### `$realm()`

A **realm** is a group of roles and defines how tokens are verified or signed.

```ts
const customers = $realm({
  secret: "*******************", // Sign tokens internally
  // OR
  jwks: { url: "https://..." }, // Verify external tokens

  roles: [
    { name: "user", permissions: [] }
  ],

  settings: {
    accessToken: {
      expiresIn: [15, "minutes"]
    },
    refreshToken: {
      enabled: true,
      expiresIn: [30, "days"]
    }
  }
});
```

> ❗️ You **cannot mix** `secret` (issuer) and `jwks` (validator) in the same realm.

**Usage**:

```http
GET /api/orders
Authorization: Bearer <accessToken>
```

---

### 🔐 Authentication

#### `$auth()`

Defines how users authenticate. Supports internal and external identity providers.

> Consider renaming to `$identity()` for clarity?

---

##### External Identity Provider (OIDC)

```ts
const external = $auth({
  realm: this.realm,
  oidc: {
    issuer: "https://my.keycloak.server",
    clientId: "xxxx-xxxx-xxxxxx",
    clientSecret: "***********************"
  }
});
```

---

##### Internal Auth with OAuth2

```ts
const github = $auth({
  realm: this.realm,
  oauth2: {
    issuer: "https://github.com",
    clientId: "xxxx",
    clientSecret: "*************"
  },
  user: (gh) => db.users.one({ email: gh.user.email })
});
```

---

##### Internal Auth with OIDC (e.g., Keycloak)

```ts
const keycloak = $auth({
  realm: this.realm,
  oidc: {
    issuer: "https://my.keycloak.server",
    clientId: "xxxx",
    clientSecret: "*************"
  },
  user: (kc) => db.users.one({ email: kc.user.email })
});
```

---

##### Username/Password Login

```ts
const usernamePassword = $auth({
  realm: this.realm,
  credentials: { /* define username/password fields */ },
  user: (entry) => db.users.one({
    email: entry.username,
    password: entry.hash
  })
});
```

---

### 🔄 Session Management

Alepha uses **stateless sessions** by default (JWT-based), but supports storing sessions in DB.

---

#### Create Session Hook

```ts
$hook({
  on: "auth:session:create",
  async ({ tokens, request }) => {
    await this.db.sessions.create({
      // Store IP, user agent, etc.
    });
  }
});
```

---

#### Validate Session on Refresh

```ts
$hook({
  on: "auth:session:refresh",
  async ({ tokens, request }) => {
    await this.db.sessions.one({
      // Throw if session is revoked
    });
  }
});
```

---

### 🧾 Token Structure

### `accessToken`

* `iat`, `exp` (default: 15 min)
* `sub` (user ID), `aud` (realm)
* Optional:

  * `roles`
  * `email`, `name`, `picture`
  * `organizations`

> Can disable fields to reduce size or prevent data leaks.

---

### `refreshToken`

* `typ: "refresh"`
* `iat`, `exp` (default: 30 days)
* `sub`, `aud`

> Can be a UUID instead of JWT, requires DB.

---

### 🍪 Cookie Management

#### Cookie for SSR Apps

```ts
const tokens = $cookie({
  ttl: // match refresh TTL
  secure: true,
  httpOnly: true,
  encrypted: true
});
```

Convert cookie to header:

```ts
$hook({
  on: "server:onRequest",
  async ({ request }) => {
    request.headers.authorization ??=
      "Bearer " + decrypt(request.cookies.tokens).accessToken;
  }
});
```

---

#### Cookie for Authorization Code Flow

```ts
const authorizationCode = $cookie();
```

---

### 📡 API Endpoints

Alepha uses OAuth2-like endpoints (but is **not** a full OAuth2 implementation).

Ref: [Connect2Id Docs](https://connect2id.com/products/server/docs/api)

#### External

* `GET /oauth/login?provider=name`
  → Redirects to external provider

* `GET /oauth/callback?provider=name`
  → Handles OIDC/OAuth2 callback
  → PKCE verifier if needed

* `GET /oauth/logout?post_logout_redirect_uri=/`
  → Logout from provider

#### Internal

* `POST /oauth/token`
  → Exchange credentials or refresh token

* `POST /oauth/token/revoke`
  → Logout (revoke refresh token)

* `GET /oauth/userinfo`
  → Extract user info from token

---

### 🗄️ Optional: Session Database

Adding session persistence enables:

* View active sessions
* Revoke individual sessions
* Logout from all devices
* Audit sessions (IP, user agent, etc.)
