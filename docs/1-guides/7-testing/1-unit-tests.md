# Unit Tests

Alepha uses Vitest as the test runner. The `alepha init --test` flag scaffolds a Vitest configuration and a sample test file. All tests run with `globals: true`, so you do not need to import `test`, `expect`, or `describe`.

## Setup

Scaffold a project with test support:

```bash
alepha init my-app --test
```

This installs Vitest and creates a `vitest.config.ts` with two test projects:

- **Node tests** -- all `*.spec.ts` files (default environment)
- **Browser tests** -- all `*.browser.spec.ts` / `*.browser.spec.tsx` files (jsdom environment)

Run tests:

```bash
yarn test                           # All tests
yarn w alepha test                  # Single package
yarn w alepha vitest run init.spec  # Filtered by pattern
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
import { Alepha, t } from "alepha";
import { $action } from "alepha/server";

class UserController {
  getUser = $action({
    path: "/users/:id",
    schema: { params: t.object({ id: t.uuid() }) },
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

### Example: File System

```typescript
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";

const alepha = Alepha.create()
  .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });

const fs = alepha.inject(MemoryFileSystemProvider);

// Run code that writes files...
await myService.generateReport();

// Assert with built-in helpers
expect(fs.wasWritten("/path/report.txt")).toBe(true);
expect(fs.wasWrittenMatching("/path/report.txt", /summary/)).toBe(true);
expect(fs.wasRead("/path/input.csv")).toBe(true);
expect(fs.wasDeleted("/path/temp.txt")).toBe(true);
```

### Example: Shell Commands

```typescript
import { ShellProvider, MemoryShellProvider } from "alepha/system";

const alepha = Alepha.create()
  .with({ provide: ShellProvider, use: MemoryShellProvider });

const shell = alepha.inject(MemoryShellProvider);

// Run code that executes shell commands...
await myService.installDependencies();

expect(shell.wasCalled("yarn install")).toBe(true);
```

## Database Testing

Alepha uses real Postgres for tests. Each test file gets its own schema. Migrations run automatically before tests and the schema is dropped after tests complete.

The connection string is set in `vitest.config.ts`:

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
