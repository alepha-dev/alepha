# Alepha - Api Users

## Installation

```bash
npm install alepha
```

## Overview

Provides user management API endpoints for Alepha applications.

This module includes user CRUD operations, authentication endpoints,
password reset functionality, and user profile management capabilities.

## API Reference

### Primitives

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $userRealm()

Already configured realm for user management.

Realm contains two roles: `admin` and `user`.

- `admin`: Has full access to all resources and permissions.
- `user`: Has access to their own resources and permissions, but cannot access admin-level resources.

Realm uses session management for handling user sessions.

Environment Variables:
- `APP_SECRET`: Secret key for signing tokens (if not provided in options).
