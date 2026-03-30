# $sse

## Import

```typescript
import { $sse } from "alepha/server";
```

## Overview

Schema configuration for an SSE endpoint.
/
export interface SseConfigSchema {
  /**
   * Request body schema.
   */
  body?: TObject;

  /**
   * Path parameters schema.
   */
  params?: TObject;

  /**
   * Query parameters schema.
   */
  query?: TObject;

  /**
   * Request headers schema.
   */
  headers?: TObject;

  /**
   * Schema for the data payload of each SSE event.
   */
  data?: TSchema;
}

// ----------------------------------------------------------------------------------------------------------

/**
Context object passed to the SSE handler function.
/
export interface SseHandlerContext<TConfig extends SseConfigSchema> {
  /**
   * Parsed request body.
   */
  body: TConfig["body"] extends TObject ? Static<TConfig["body"]> : any;

  /**
   * Parsed path parameters.
   */
  params: TConfig["params"] extends TObject
    ? Static<TConfig["params"]>
    : Record<string, string>;

  /**
   * Parsed query parameters.
   */
  query: TConfig["query"] extends TObject
    ? Partial<Static<TConfig["query"]>>
    : Record<string, any>;

  /**
   * Parsed request headers.
   */
  headers: TConfig["headers"] extends TObject
    ? Static<TConfig["headers"]>
    : Record<string, string>;

  /**
   * The underlying server request object.
   */
  request: ServerRequest;

  /**
   * Emit an SSE event to the client.
   */
  emit: (
    data: TConfig["data"] extends TSchema ? Static<TConfig["data"]> : any,
  ) => void;

  /**
   * Close the SSE stream.
   */
  close: () => void;
}

/**
Handler function type for SSE endpoints.
/
export type SseHandler<TConfig extends SseConfigSchema = SseConfigSchema> = (
  context: SseHandlerContext<TConfig>,
) => Async<void>;

// ----------------------------------------------------------------------------------------------------------

/**
Options for the $sse primitive.
/
export interface SsePrimitiveOptions<TConfig extends SseConfigSchema>
  extends PipelinePrimitiveOptions {
  /**
   * Name of the SSE endpoint.
   */
  name?: string;

  /**
   * Group SSE endpoints together.
   */
  group?: string;

  /**
   * Pathname of the route. If not provided, property key is used.
   */
  path?: string;

  /**
   * The config schema for the SSE endpoint.
   */
  schema?: TConfig;

  /**
   * A short description of the endpoint. Used for documentation purposes.
   */
  description?: string;

  /**
   * Disable the SSE endpoint.
   */
  disabled?: boolean;

  /**
   * Main SSE handler. Receives context with emit/close functions.
   */
  handler: SseHandler<TConfig>;
}

// ----------------------------------------------------------------------------------------------------------

/**
Async iterable stream of SSE events.

Supports push-based event delivery via `push()`, error propagation
via `fail()`, and clean termination via `end()`.
/
export class SseStream<T> implements AsyncIterable<T> {
  protected queue: T[] = [];
  protected error: Error | null = null;
  protected done = false;
  protected resolve: (() => void) | null = null;
  protected listeners: Array<(data: T) => void> = [];

  /**
   * Push a new event into the stream.
   */
  public push(data: T): void {
    if (this.done) return;
    this.queue.push(data);
    for (const listener of this.listeners) {
      listener(data);
    }
    if (this.resolve) {
      this.resolve();
      this.resolve = null;
    }
  }

  /**
   * Signal an error on the stream.
   */
  public fail(error: Error): void {
    this.error = error;
    this.done = true;
    if (this.resolve) {
      this.resolve();
      this.resolve = null;
    }
  }

  /**
   * End the stream gracefully.
   */
  public end(): void {
    this.done = true;
    if (this.resolve) {
      this.resolve();
      this.resolve = null;
    }
  }

  /**
   * Subscribe to new events as they arrive.
   */
  public subscribe(listener: (data: T) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      while (this.queue.length > 0) {
        yield this.queue.shift()!;
      }
      if (this.error) {
        throw this.error;
      }
      if (this.done) {
        return;
      }
      await new Promise<void>((r) => {
        this.resolve = r;
      });
    }
  }
}

// ----------------------------------------------------------------------------------------------------------

/**
Response wrapper for SSE fetch requests.

Wraps a standard `Response` and parses the `text/event-stream` body
into an async iterable of typed events.
/
export class SseFetchResponse<T> implements AsyncIterable<T> {
  public readonly response: Response;

  constructor(response: Response) {
    this.response = response;
  }

  /**
   * HTTP status code of the response.
   */
  public get status(): number {
    return this.response.status;
  }

  /**
   * HTTP status text of the response.
   */
  public get statusText(): string {
    return this.response.statusText;
  }

  /**
   * Response headers.
   */
  public get headers(): Headers {
    return this.response.headers;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    const reader = this.response.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            try {
              yield JSON.parse(data) as T;
            } catch {
              // skip non-JSON data lines
            }
          }
        }
      }

      // process remaining buffer
      if (buffer.startsWith("data: ")) {
        const data = buffer.slice(6);
        try {
          yield JSON.parse(data) as T;
        } catch {
          // skip non-JSON data lines
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

// ----------------------------------------------------------------------------------------------------------

/**
Creates a Server-Sent Events (SSE) primitive for streaming typed events to clients.

SSE endpoints provide a unidirectional stream from server to client over HTTP,
with full type safety for event data. The handler receives `emit()` and `close()`
functions to control the stream.

**Key Features**
- Full TypeScript inference for event data types
- Automatic schema validation using TypeBox
- Convention-based URL generation with customizable paths
- Direct invocation (`run()`) returns an `SseStream` async iterable
- HTTP requests (`fetch()`) returns an `SseFetchResponse` async iterable
- Built-in `text/event-stream` content-type handling

**URL Generation**

All `$sse` paths are automatically prefixed with `/api`.

```ts
$sse({ path: "/events" })     // POST /api/events
$sse({ path: "/feed/:id" })   // POST /api/feed/:id
```

The HTTP method is always POST.

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | `string` | No | Name of the SSE endpoint. |
| `group` | `string` | No | Group SSE endpoints together. |
| `path` | `string` | No | Pathname of the route |
| `schema` | `TConfig` | No | The config schema for the SSE endpoint. |
| `description` | `string` | No | A short description of the endpoint |
| `disabled` | `boolean` | No | Disable the SSE endpoint. |
| `handler` | `SseHandler&lt;TConfig&gt;` | Yes | Main SSE handler |

## Examples

```ts
class NotificationController {
  events = $sse({
    schema: {
      data: t.object({
        type: t.text(),
        message: t.text(),
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

