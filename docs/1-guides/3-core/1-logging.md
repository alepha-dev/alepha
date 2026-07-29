# Logging

Alepha provides structured logging via the `$logger` primitive from `alepha/logger`.

## Basic Usage

```typescript check
import { $logger } from "alepha/logger";

class UserService {
  log = $logger();

  async createUser(name: string) {
    this.log.info("Creating user", { name });
    // prints: [23:45:53.326] INFO <app.UserService>: Creating user {"name":"alice"}
  }
}
```

`$logger()` returns a `Logger` instance. The logger name defaults to the class name.
The module defaults to `"app"` (or the module name if the service belongs to a `$module`).

You can override the name:

```typescript
class App {
  log = $logger({ name: "Bootstrap" });
}
```

You can add an `app` field to all log entries by setting the `APP_NAME` environment variable:

```bash
APP_NAME=my-app
```

This is useful for identifying logs from different applications in a shared logging system.

## Log Levels

The `LoggerInterface` exposes five methods:

```typescript
export interface LoggerInterface {
  trace(message: string, data?: unknown): void;
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}
```

Severity order from lowest to highest: `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, `SILENT`.

A log call is only written to the destination if its level is at or above the configured threshold. `SILENT` suppresses all output.

## Configuration

### LOG_LEVEL

Set via the `LOG_LEVEL` environment variable. Case-insensitive.

```bash
# Global level
LOG_LEVEL=debug

# Per-module level with global fallback
LOG_LEVEL=alepha.core:trace,info

# Multiple module overrides
LOG_LEVEL=alepha.core:trace,alepha.server:debug,my.app:error,info
```

The syntax is `module_prefix:level` pairs separated by commas or semicolons, with an optional global level at the end. Module matching uses prefix matching: `alepha` matches `alepha.core`, `alepha.server`, etc.

Wildcard patterns are supported:

```bash
LOG_LEVEL=alepha.*:debug,*.test:silent,info
```

Defaults by environment:
- **dev**: `info`
- **prod**: `info` (server) / `warn` (browser)
- **test**: `trace` (but logs go to memory, only printed on test failure)

### LOG_FORMAT

Set via the `LOG_FORMAT` environment variable.

| Value | Description | Provider |
|-------|-------------|----------|
| `pretty` | Colored, human-readable output with timestamps, module and context | `PrettyFormatterProvider` |
| `cli` | Compact output for CLI sessions: `HH:MM:SS L message {json}` (no module/context) | `CliFormatterProvider` |
| `json` | Structured JSON, one object per line | `JsonFormatterProvider` |
| `raw` | Plain message text, no metadata (best for piping) | `RawFormatterProvider` |

If `LOG_FORMAT` is not set:
- **Production** (non-browser): defaults to `json`
- **Everything else**: defaults to `pretty`

The `alepha` and `create-alepha` CLIs default to `cli`. Pass `--verbose` to a
CLI command to switch to `pretty` at `trace` level when you need module/context
and the framework's internal logs. An agent session (Claude Code sets the
`CLAUDECODE` env var) implies `--verbose`.

### Sub-process output

CLI tasks that shell out (`yarn lint`, `vite build`, nested `alepha`
subcommands, …) only stream their output live when `DEBUG` or a more verbose
level is enabled — i.e. under `--verbose`, `CLAUDECODE`, or `LOG_LEVEL=debug`.
Below `DEBUG` (the default), that output is captured instead of streamed, so a
quiet run such as `alepha verify` is not buried under thousands of sub-process
lines. Captured output is still surfaced (stdout **and** stderr) if the task
fails, and the `Starting … / Finished … after Ns` lines always print.

## Log Entry Structure

Every log call produces a `LogEntry`:

```typescript
interface LogEntry {
  level: "SILENT" | "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR";
  message: string;
  service: string;   // class name, e.g. "UserService"
  module: string;    // module name, e.g. "app" or "my.project.users"
  context?: string;  // request-scoped correlation ID (from AsyncLocalStorage)
  app?: string;      // APP_NAME env variable
  data?: unknown;    // arbitrary payload or Error object
  timestamp: number; // milliseconds since epoch
}
```

## Log Events

Every log call emits a `"log"` event on the Alepha event system, regardless of whether the message was above the configured threshold. This allows external listeners to capture all log activity:

```typescript
alepha.events.on("log", (event) => {
  // event.message  - formatted string (or undefined if below threshold)
  // event.entry    - the raw LogEntry
});
```

## Testing

In test mode, Alepha routes logs to `MemoryDestinationProvider` by default (unless `LOG_LEVEL` or `DEBUG` is set, which switches back to console output). Logs are buffered in memory and only printed to the console if a test fails.

To capture and assert on logs in tests:

```typescript
import { Alepha } from "alepha";
import { $logger, LogDestinationProvider, MemoryDestinationProvider } from "alepha/logger";

class App {
  log = $logger();
}

test("should log info message", ({ expect }) => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "trace" },
  }).with({
    provide: LogDestinationProvider,
    use: MemoryDestinationProvider,
  });

  const output = alepha.inject(MemoryDestinationProvider);
  const app = alepha.inject(App);

  app.log.info("Test log message");

  expect(output.logs[0].message).toBe("Test log message");
  expect(output.logs[0].level).toBe("INFO");
  expect(output.logs[0].service).toBe("App");
});
```

## Custom Destination

Replace the log destination by substituting `LogDestinationProvider`:

```typescript
import { LogDestinationProvider } from "alepha/logger";
import type { LogEntry } from "alepha/logger";

class MyDestination extends LogDestinationProvider {
  write(message: string, entry: LogEntry): void {
    // send to external service, write to file, etc.
  }
}

const alepha = Alepha.create().with({
  provide: LogDestinationProvider,
  use: MyDestination,
});
```

## Custom Formatter

Replace the log formatter by substituting `LogFormatterProvider`:

```typescript
import { LogFormatterProvider } from "alepha/logger";
import type { LogEntry } from "alepha/logger";

class MyFormatter extends LogFormatterProvider {
  format(entry: LogEntry): string {
    return `[${entry.level}] ${entry.module}.${entry.service}: ${entry.message}`;
  }
}

const alepha = Alepha.create().with({
  provide: LogFormatterProvider,
  use: MyFormatter,
});
```
