# $sse

## Import

```typescript
import { $sse } from "alepha/server";
```

## Overview

Creates a Server-Sent Events (SSE) primitive for streaming typed events to clients.

SSE endpoints provide a unidirectional stream from server to client over HTTP,
with full type safety for event data. The handler receives `emit()` and `close()`
functions to control the stream.

**Key Features**

- Full TypeScript inference for event data types
- Automatic schema validation using Zod
- An explicit path on every endpoint, no convention to remember
- Direct invocation (`run()`) returns an `SseStream` async iterable
- HTTP requests (`fetch()`) returns an `SseFetchResponse` async iterable
- Built-in `text/event-stream` content-type handling

**URL Generation**

All `$sse` paths are automatically prefixed with `/api`.

```ts
$sse({ path: "/events" }); // POST /api/events
$sse({ path: "/feed/:id" }); // POST /api/feed/:id
```

The HTTP method is always POST. `path` is required, so renaming the
property never moves the URL.

## Options

| Option        | Type                              | Required | Description                                                                                                                                                            |
| ------------- | --------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | `string`                          | No       | Name of the SSE endpoint.                                                                                                                                              |
| `group`       | `string`                          | No       | Group SSE endpoints together.                                                                                                                                          |
| `path`        | `string`                          | Yes      | Pathname of the route, below the API prefix (`/api` by default)                                                                                                        |
| `schema`      | `TConfig`                         | No       | The config schema for the SSE endpoint.                                                                                                                                |
| `description` | `string`                          | No       | A short description of the endpoint                                                                                                                                    |
| `disabled`    | `boolean`                         | No       | Disable the SSE endpoint.                                                                                                                                              |
| `use`         | `TUse`                            | No       | Middlewares wrapping the handler, as on `$action`: `use: [$secure()]` refuses an anonymous caller before the stream opens and hands the handler a non-optional `user`. |
| `handler`     | `SseHandler&lt;TConfig, TUse&gt;` | Yes      |                                                                                                                                                                        |

## Examples

```ts
class NotificationController {
  events = $sse({
    path: "/notifications/events",
    schema: {
      data: z.object({
        type: z.text(),
        message: z.text(),
      }),
    },
    handler: async ({ emit, close }) => {
      emit({ type: "welcome", message: "Connected!" });
      // ... stream events ...
      close();
    },
  });
}
```
