# Alepha Api Users

User management API endpoints for Alepha applications.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Provides user management API endpoints for Alepha applications.

This module includes user CRUD operations, authentication endpoints,
and user profile management capabilities.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";

const alepha = Alepha.create()
	.with(AlephaApiUsers);

run(alepha);
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

#### $authApple()

TODO: Implement Apple authentication

#### $authGithub()

Already configured GitHub authentication descriptor.

Uses OAuth2 to authenticate users via their GitHub accounts.
Upon successful authentication, it links the GitHub account to a user session.

Environment Variables:
- `GITHUB_CLIENT_ID`: The client ID obtained from the GitHub Developer Settings.
- `GITHUB_CLIENT_SECRET`: The client secret obtained from the GitHub Developer Settings.

#### $authGoogle()

Already configured Google authentication descriptor.

Uses OpenID Connect (OIDC) to authenticate users via their Google accounts.
Upon successful authentication, it links the Google account to a user session.

Environment Variables:
- `GOOGLE_CLIENT_ID`: The client ID obtained from the Google Developer Console.
- `GOOGLE_CLIENT_SECRET`: The client secret obtained from the Google Developer Console.

#### $realmUsers()

Already configured realm for user management.

Realm contains two roles: `admin` and `user`.

- `admin`: Has full access to all resources and permissions.
- `user`: Has access to their own resources and permissions, but cannot access admin-level resources.

Realm uses session management for handling user sessions.

Environment Variables:
- `APP_SECRET`: Secret key for signing tokens (if not provided in options).
