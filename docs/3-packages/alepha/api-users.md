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

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

#### $userRealm()

Secret key for signing tokens.
  
  If not provided, the secret from the SecurityProvider will be used (usually from the APP_SECRET environment variable).
  /
  secret?: string;

  /**
  Realm configuration options.
  
  It's already pre-configured for user management with admin and user roles.
  /
  realm?: Partial<RealmDescriptorOptions>;

  /**
  Override entities.
  /
  entities?: {
    users?: EntityDescriptor;
    identities?: EntityDescriptor;
    sessions?: EntityDescriptor;
    organizations?: EntityDescriptor;
  }
}

/**
Already configured realm for user management.

Realm contains two roles: `admin` and `user`.

- `admin`: Has full access to all resources and permissions.
- `user`: Has access to their own resources and permissions, but cannot access admin-level resources.

Realm uses session management for handling user sessions.

Environment Variables:
- `APP_SECRET`: Secret key for signing tokens (if not provided in options).
