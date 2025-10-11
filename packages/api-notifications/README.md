# Alepha Api Notifications

Notification management API endpoints for Alepha applications.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Provides notification management API endpoints for Alepha applications.

This module includes notification sending, retrieval, status tracking,
and user notification preferences management.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaApiNotifications } from "alepha/api/notifications";

const alepha = Alepha.create()
	.with(AlephaApiNotifications);

run(alepha);
```
