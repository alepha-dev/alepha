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
