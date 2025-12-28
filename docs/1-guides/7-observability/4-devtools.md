# DevTools

Alepha has built-in DevTools for development. It's like Redux DevTools but for your entire backend.

## Setup

```typescript
import { Alepha } from "alepha";
import { AlephaDevtools } from "@alepha/devtools";

const alepha = Alepha.create()
  .with(AlephaDevtools);

// visit http://localhost:3000/devtools
```

## Features

### Application Metadata

See everything registered in your app:

- **Actions** - All HTTP endpoints with their schemas
- **Schedulers** - Cron jobs and their schedules
- **Queues** - Background job queues
- **Topics** - Pub/sub topics
- **Buckets** - File storage buckets
- **Caches** - Cached computations
- **Realms** - Authentication realms
- **Pages** - React SSR pages
- **Modules** - Registered modules and their services

### Live Logs

The DevTools UI shows the last 10,000 log entries, filterable by:

- Log level (trace, debug, info, warn, error)
- Module name
- Search text

Logs are captured in real-time as your app runs.

### API Endpoints

DevTools also exposes API endpoints for programmatic access:

```
GET /devtools           # DevTools UI
GET /devtools/metadata  # Application metadata as JSON
GET /devtools/logs      # Last 10,000 log entries as JSON
```

## Use Cases

### Debugging

When something goes wrong:

1. Open DevTools
2. Filter logs by the relevant module
3. See exactly what happened

### API Discovery

New to a codebase? DevTools shows you:

- All available endpoints
- Their request/response schemas
- What queues and schedulers exist

### Development Workflow

Keep DevTools open while developing:

- See requests as they come in
- Watch background jobs execute
- Monitor scheduler triggers

## Production Warning

DevTools exposes internal application details. **Don't enable it in production** unless you've secured access:

```typescript
import { AlephaDevtools } from "@alepha/devtools";

const alepha = Alepha.create();

if (process.env.NODE_ENV !== "production") {
  alepha.with(AlephaDevtools);
}
```

Or protect it with authentication:

```typescript
import { $route } from "alepha/server";

class SecureDevtools {
  devtools = $route({
    method: "GET",
    path: "/devtools/*",
    handler: async (c) => {
      const token = c.req.header("Authorization");
      if (token !== `Bearer ${process.env.DEVTOOLS_TOKEN}`) {
        return c.text("Unauthorized", 401);
      }
      // proxy to devtools...
    },
  });
}
```

## Tips

1. **Bookmark it** - `http://localhost:3000/devtools` should be in your browser favorites
2. **Use log filtering** - Don't scroll through thousands of logs, filter by module
3. **Check metadata first** - When debugging, see what's registered before diving into logs
4. **Keep it open** - Run it alongside your app during development
