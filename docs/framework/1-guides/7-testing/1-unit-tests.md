# Unit Tests

Alepha uses Vitest as the test runner. Every `alepha init` scaffolds a Vitest config and a sample test file — Vitest ships embedded in `alepha`, so there is nothing to install. All tests run with `globals: true`, so you do not need to import `test`, `expect`, or `describe`.

## Setup

Every Alepha project is scaffolded with test support — no flag needed:

```bash
alepha init my-app
```

`init` writes the Vitest `test` block into `vite.config.ts` (it pins `test.root` so a parent monorepo config can't take over) and a starter `test/dummy.spec.ts` — there is no separate Vitest config file. Specs live in `test/`, named `*.spec.ts`.

Run tests with `alepha test`. Positional arguments are forwarded to Vitest as filename/test filters:

```bash
alepha test                    # All tests
alepha test auth               # Only specs matching "auth"
alepha test test/user.spec.ts  # A single file
```

## Lifecycle Management

`Alepha.create()` handles start and stop automatically in test environments. You do not need `beforeAll`/`afterAll` for lifecycle.

```typescript
test("should inject a service", async () => {
  const alepha = Alepha.create().with(MyService);
  const svc = alepha.inject(MyService);
  await alepha.start();

  const result = await svc.doSomething();
  expect(result).toBe("done");
});
```

## Testing Actions

Actions expose two call modes: `.run()` for in-process invocation and `.fetch()` for HTTP simulation.

```typescript
import { Alepha, z } from "alepha";
import { $action } from "alepha/server";

class UserController {
  getUser = $action({
    path: "/users/:id",
    schema: { params: z.object({ id: z.uuid() }) },
    handler: async ({ params }) => ({ id: params.id, name: "Alice" }),
  });
}

test("should return user by id", async () => {
  const alepha = Alepha.create().with(UserController);
  const ctrl = alepha.inject(UserController);

  // Local call - no HTTP overhead
  const result = await ctrl.getUser.run({ params: { id: "abc-123" } });
  expect(result.name).toBe("Alice");

  // HTTP simulation - goes through the full request pipeline
  const response = await ctrl.getUser.fetch({ params: { id: "abc-123" } });
  expect(response.status).toBe(200);
});
```

## DI Substitution (No vi.mock)

Never use `vi.mock()` or `vi.spyOn()`. Alepha's dependency injection system replaces the need for traditional mocking. Use `.with({ provide, use })` to swap implementations.

```typescript
const alepha = Alepha.create()
  .with({ provide: PaymentService, use: FakePaymentService });

const svc = alepha.inject(PaymentService);
// svc is now an instance of FakePaymentService
```

## Memory Providers

Alepha ships memory implementations for all I/O-bound services. These run in-process with no external dependencies and include test assertion helpers.

| Provider | Import | Replaces |
|----------|--------|----------|
| `MemoryFileSystemProvider` | `alepha/system` | File system |
| `MemoryShellProvider` | `alepha/system` | Shell commands |
| `MemoryQueueProvider` | `alepha/queue` | Job queues |
| `MemoryTopicProvider` | `alepha/topic` | Pub/sub topics |
| `MemoryLockProvider` | `alepha/lock` | Distributed locks |
| `MemoryCacheProvider` | `alepha/cache` | Caching layer |
| `MemoryFileStorageProvider` | `alepha/bucket` | File storage (S3, R2, etc.) |
| `MemoryEmailProvider` | `alepha/email` | Email sending |
| `MemorySmsProvider` | `alepha/sms` | SMS sending |

In test environments, `FileSystemProvider` and `ShellProvider` both default to
their memory implementations automatically — file writes and shell commands
stay inside the container unless a test opts back into the real thing:

```typescript
import { FileSystemProvider, NodeFileSystemProvider } from "alepha/system";

// Only when a test really needs the disk (e.g. real fixture files):
const alepha = Alepha.create()
  .with({ provide: FileSystemProvider, use: NodeFileSystemProvider });
```

### Example: File System

```typescript
import { MemoryFileSystemProvider } from "alepha/system";

const alepha = Alepha.create(); // memory file system is the test default

const fs = alepha.inject(MemoryFileSystemProvider);

// Run code that writes files...
await myService.generateReport();

// Assert with built-in helpers
expect(fs.wasWritten("/path/report.txt")).toBe(true);
expect(fs.wasWrittenMatching("/path/report.txt", /summary/)).toBe(true);
expect(fs.wasDeleted("/path/temp.txt")).toBe(true);
```

### Example: Shell Commands

```typescript
import { MemoryShellProvider } from "alepha/system";

const alepha = Alepha.create(); // memory shell is the test default

const shell = alepha.inject(MemoryShellProvider);

// Run code that executes shell commands...
await myService.installDependencies();

expect(shell.wasCalled("yarn install")).toBe(true);

// Structured results work too: a configured error becomes exitCode 1,
// mirroring ShellProvider.capture() on the real runtimes.
shell.errors.set("git diff --quiet", "dirty");
const result = await shell.capture("git diff --quiet");
expect(result.exitCode).toBe(1);
```

## Time Travel

Code that reads time through the injected `DateTimeProvider` (never `Date.now()`) is testable by moving the clock:

```typescript
const dateTime = alepha.inject(DateTimeProvider);
dateTime.pause();               // freeze the clock
await dateTime.travel([2, "hours"]); // jump forward
```

`travel()` also resolves `CronProvider` waits — **every `$job` cron in the container fires**, not just the one you are testing. Assert end state, not call counts, or a second cron firing will fail an otherwise-correct test.

## Database Testing

Alepha can run tests against real Postgres. Each test file gets its own schema. Migrations run automatically before tests and the schema is dropped after tests complete.

Point `DATABASE_URL` at your test database via the `env` block of `vite.config.ts`'s `test` section (the scaffolded config doesn't set one — without it, tests use the default embedded SQLite database):

```typescript
env: {
  DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/postgres",
}
```

## TestProvider Pattern

To unit test protected methods on a class, create a test subclass that exposes them:

```typescript
class TestCliProvider extends CliProvider {
  public testParseFlags = this.parseFlags.bind(this);
  public testResolveCommand = this.resolveCommand.bind(this);
}

const alepha = Alepha.create();
const cli = alepha.inject(TestCliProvider);
const result = cli.testParseFlags(["--verbose"], flagDefs);
```
