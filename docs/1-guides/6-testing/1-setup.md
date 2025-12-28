# Testing Setup

You know that feeling when you write tests for an Express app? Mocking `req`, `res`, setting up supertest, hoping your middleware chain doesn't break...

Alepha makes testing almost enjoyable. Almost.

## Vitest Configuration

Alepha integrates with **Vitest**. For automatic lifecycle management, you need `globals: true` in your vitest config:

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true, // required for automatic start/stop
  },
});
```

With `globals: true`, Alepha hooks into `describe` and `it` to manage the app lifecycle automatically.

## Lifecycle Behavior

Where you create your Alepha instance matters:

```typescript
import { describe, it, expect } from "vitest";
import { Alepha } from "alepha";

describe("MyService", () => {
  // alepha created at describe level = auto started before tests
  const alepha = Alepha.create().with(MyService);
  const service = alepha.inject(MyService);

  it("should do something", async () => {
    // alepha is already started here, no need to call start()
    const result = await service.doSomething();
    expect(result).toBe("done");
  });

  it("should do something else", async () => {
    // still started, same instance for all tests in this describe
    const result = await service.doSomethingElse();
    expect(result).toBe("done");
  });
});
// alepha.stop() called automatically after all tests
```

If you create Alepha **inside** an `it` block, you need to call `start()` manually:

```typescript
describe("MyService", () => {
  it("should work with manual start", async () => {
    // alepha created inside it = manual start required
    const alepha = Alepha.create().with(MyService);
    const service = alepha.inject(MyService);

    await alepha.start(); // required!

    const result = await service.doSomething();
    expect(result).toBe("done");
  });
  // alepha.stop() still called automatically
});
```

## Testing Services

Services are just classes. Test them like classes.

```typescript
import { describe, it, expect } from "vitest";
import { Alepha } from "alepha";
import { UserService } from "./UserService";

describe("UserService", () => {
  const alepha = Alepha.create().with(UserService);
  const service = alepha.inject(UserService);

  it("should create a user", async () => {
    const user = await service.create({
      email: "test@example.com",
      name: "Test User",
    });

    expect(user.id).toBeDefined();
    expect(user.email).toBe("test@example.com");
  });
});
```

## Testing Actions

You can test actions in two ways: **local** (direct call) or **HTTP** (full request cycle).

### Local Testing with `run()`

```typescript
import { describe, it, expect } from "vitest";
import { Alepha, t } from "alepha";
import { $action } from "alepha/server";

class UserApi {
  getUser = $action({
    path: "/users/:id",
    schema: {
      params: t.object({ id: t.text() }),
      response: t.object({ id: t.text(), name: t.text() }),
    },
    handler: async ({ params }) => {
      return { id: params.id, name: "John" };
    },
  });
}

describe("UserApi", () => {
  const alepha = Alepha.create().with(UserApi);
  const api = alepha.inject(UserApi);

  it("should return user by id", async () => {
    // local call, skips HTTP layer entirely
    const user = await api.getUser.run({ params: { id: "123" } });
    expect(user.name).toBe("John");
  });
});
```

### HTTP Testing with `fetch()`

Sometimes you need to test the full HTTP cycle. Maybe you have security hooks, rate limiting, or middleware that only runs on real HTTP requests:

```typescript
describe("UserApi", () => {
  const alepha = Alepha.create().with(UserApi);
  const api = alepha.inject(UserApi);

  it("should enforce auth via HTTP", async () => {
    // forces actual HTTP request through the full middleware chain
    const response = await api.getUser.fetch({ params: { id: "123" } });

    // now you can test HTTP-specific behavior
    expect(response.status).toBe(401); // auth required
  });

  it("should work with valid token", async () => {
    const response = await api.getUser.fetch({
      params: { id: "123" },
      headers: { Authorization: "Bearer valid-token" },
    });

    expect(response.status).toBe(200);
  });
});
```

**Use `run()` for most tests** - it's faster and gives clearer errors. Use `fetch()` when you specifically need to test HTTP-level behavior like authentication hooks, CORS, rate limiting, or response headers.

## Testing with Databases

When testing with PostgreSQL, Alepha creates an **isolated schema** for each test file. The schema name is derived from `PG_TEST_SCHEMA` or generated automatically. After tests complete, the schema is destroyed.

This means:
- Tests in different files don't interfere with each other
- No manual cleanup needed
- Tables are created automatically from your entities

```typescript
import { describe, it, expect } from "vitest";
import { Alepha, t } from "alepha";
import { $entity, $repository, pg } from "alepha/orm";

const userEntity = $entity({
  name: "users",
  schema: t.object({
    id: pg.primaryKey(),
    email: t.email(),
  }),
});

class Db {
  users = $repository(userEntity);
}

describe("UserRepository", () => {
  const alepha = Alepha.create().with(Db);
  const db = alepha.inject(Db);

  it("should create and find user", async () => {
    const user = await db.users.create({ email: "test@test.com" });
    expect(user.id).toBeDefined();

    const found = await db.users.findById(user.id);
    expect(found?.email).toBe("test@test.com");
  });

  it("should list users", async () => {
    // this runs in the same schema, sees data from previous test
    const users = await db.users.findMany();
    expect(users.length).toBeGreaterThan(0);
  });
});
// schema destroyed after all tests in this file
```

## In-Memory Providers

Here's something important: **all external providers use in-memory implementations during tests**.

- `$queue` → `MemoryQueueProvider`
- `$topic` → `MemoryTopicProvider`
- `$email` → `MemoryEmailProvider`
- `$sms` → `MemorySmsProvider`
- `$cache` → `MemoryCacheProvider`
- `$lock` → `MemoryLockProvider`

No fear of accidentally sending real emails or SMS during tests. Everything stays in memory.

### Verifying Emails Were Sent

```typescript
import { describe, it, expect } from "vitest";
import { Alepha } from "alepha";
import { MemoryEmailProvider } from "alepha/email";

describe("SignupService", () => {
  const alepha = Alepha.create().with(SignupService);
  const service = alepha.inject(SignupService);
  const emailProvider = alepha.inject(MemoryEmailProvider);

  it("should send welcome email", async () => {
    await service.signup({ email: "new@user.com" });

    // check in-memory store
    const sent = emailProvider.sent;
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("new@user.com");
    expect(sent[0].subject).toContain("Welcome");
  });
});
```

Same pattern works for SMS:

```typescript
import { MemorySmsProvider } from "alepha/sms";

const smsProvider = alepha.inject(MemorySmsProvider);
expect(smsProvider.sent[0].to).toBe("+1234567890");
```

## Service Substitution (Recommended)

Alepha's `.with({ provide, use })` is the **recommended way to mock dependencies**. It's explicit, type-safe, and doesn't rely on module magic.

```typescript
import { describe, it, expect } from "vitest";
import { Alepha } from "alepha";

class PaymentGateway {
  async charge(amount: number): Promise<string> {
    // real Stripe call
    return "ch_real_charge_id";
  }
}

class MockPaymentGateway extends PaymentGateway {
  charges: number[] = [];

  async charge(amount: number): Promise<string> {
    this.charges.push(amount);
    return "ch_mock_charge_id";
  }
}

describe("OrderService", () => {
  const alepha = Alepha.create()
    .with(OrderService)
    .with({ provide: PaymentGateway, use: MockPaymentGateway });

  const orderService = alepha.inject(OrderService);
  const mockPayment = alepha.inject(MockPaymentGateway);

  it("should charge the correct amount", async () => {
    await orderService.checkout({ total: 99.99 });

    expect(mockPayment.charges).toContain(99.99);
  });
});
```

### What About Vitest Mocks?

**Module mocking (`vi.mock()`) is discouraged.** It's brittle, hard to type, and fights against Alepha's dependency injection.

**Spies (`vi.spyOn()`) are fine** when you need to verify a method was called without replacing the implementation:

```typescript
import { vi, describe, it, expect } from "vitest";

describe("AuditService", () => {
  const alepha = Alepha.create().with(AuditService);
  const service = alepha.inject(AuditService);

  it("should log audit events", async () => {
    const spy = vi.spyOn(service, "log");

    await service.recordAction("user_login", { userId: "123" });

    expect(spy).toHaveBeenCalledWith("user_login", { userId: "123" });
  });
});
```

But prefer service substitution when possible. It's more explicit about what you're testing.

## Generating Fake Data

Use `FakeProvider` to generate realistic test data. **Always inject it, never use `new`:**

```typescript
import { describe, it, expect } from "vitest";
import { Alepha, t } from "alepha";
import { FakeProvider } from "alepha/fake";

describe("FakeProvider", () => {
  const alepha = Alepha.create();
  const fake = alepha.inject(FakeProvider); // inject, don't use new!

  it("should generate valid user data", () => {
    const userSchema = t.object({
      id: t.uuid(),
      email: t.email(),
      firstName: t.text(),
      age: t.integer({ minimum: 18, maximum: 99 }),
    });

    const user = fake.generate(userSchema);

    // uses property names as hints
    // email → generates email
    // firstName → generates first name
    expect(user.email).toContain("@");
    expect(user.age).toBeGreaterThanOrEqual(18);
  });
});
```

## Test Organization

We recommend this structure:

```
src/
  users/
    UserService.ts
    UserApi.ts
test/
  users/
    UserService.spec.ts    # unit tests
    UserApi.spec.ts        # action tests
  integration/
    signup-flow.spec.ts    # full flow tests
```

Name your test files `.spec.ts`. For browser tests (jsdom), use `.browser.spec.ts` - see [Vitest documentation](https://vitest.dev/guide/browser.html) for configuration details.

## Common Patterns

### Arrange-Act-Assert

```typescript
import { describe, it, expect } from "vitest";
import { Alepha } from "alepha";

describe("UserService", () => {
  const alepha = Alepha.create().with(UserService);
  const service = alepha.inject(UserService);

  it("should deactivate user", async () => {
    // arrange
    const user = await service.create({ email: "test@test.com" });

    // act
    await service.deactivate(user.id);

    // assert
    const updated = await service.findById(user.id);
    expect(updated?.active).toBe(false);
  });
});
```

### Testing Errors

```typescript
import { describe, it, expect } from "vitest";
import { Alepha } from "alepha";

describe("UserService", () => {
  const alepha = Alepha.create().with(UserService);
  const service = alepha.inject(UserService);

  it("should throw on invalid email", async () => {
    await expect(
      service.create({ email: "not-an-email" })
    ).rejects.toThrow("Invalid email");
  });
});
```

## Tips

1. **Use `globals: true`** - enables automatic lifecycle management
2. **Create Alepha at describe level** - avoids manual `start()` calls
3. **Use `.with()` for mocking** - explicit and type-safe
4. **Use `run()` for most tests** - faster than HTTP
5. **Use `fetch()` for HTTP-specific tests** - security hooks, headers, etc.
6. **Inject FakeProvider** - never use `new FakeProvider()`
7. **Trust in-memory providers** - no accidental emails or SMS
8. **Avoid `vi.mock()`** - use service substitution instead

Testing with Alepha isn't painful. It's just... testing. The way it should be.
