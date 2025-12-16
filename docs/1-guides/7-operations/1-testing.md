# Testing

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

## Rules



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

# Essential Rules for Naming Tests

Source: https://alexop.dev/posts/frontend-testing-guide-10-essential-rules/

## Rule 1: Always Use "should" + Verb

Every test name should start with "should" followed by an action verb.

```js
// ❌ Bad
it("displays the error message", () => {});
it("modal visibility", () => {});
it("form validation working", () => {});

// ✅ Good
it("should display error message when validation fails", () => {});
it("should show modal when trigger button is clicked", () => {});
it("should validate form when user submits", () => {});
```

**Generic Pattern:** `should [verb] [expected outcome]`

## Rule 2: Include the Trigger Event

Specify what causes the behavior you're testing.

```js
// ❌ Bad
it("should update counter", () => {});
it("should validate email", () => {});
it("should show dropdown", () => {});

// ✅ Good
it("should increment counter when plus button is clicked", () => {});
it("should show error when email format is invalid", () => {});
it("should open dropdown when toggle is clicked", () => {});
```

**Generic Pattern:** `should [verb] [expected outcome] when [trigger event]`

## Rule 3: Group Related Tests with Descriptive Contexts

Use describe blocks to create clear test hierarchies.

```js
// ❌ Bad
describe("AuthForm", () => {
  it("should test empty state", () => {});
  it("should test invalid state", () => {});
  it("should test success state", () => {});
});

// ✅ Good
describe("AuthForm", () => {
  describe("when form is empty", () => {
    it("should disable submit button", () => {});
    it("should not show any validation errors", () => {});
  });

  describe("when submitting invalid data", () => {
    it("should show validation errors", () => {});
    it("should keep submit button disabled", () => {});
  });
});
```

**Generic Pattern:**

```js
describe("[Component/Feature]", () => {
  describe("when [specific condition]", () => {
    it("should [expected behavior]", () => {});
  });
});
```

## Rule 4: Name State Changes Explicitly

Clearly describe the before and after states in your test names.

```js
// ❌ Bad
it("should change status", () => {});
it("should update todo", () => {});
it("should modify permissions", () => {});

// ✅ Good
it("should change status from pending to approved", () => {});
it("should mark todo as completed when checkbox clicked", () => {});
it("should upgrade user from basic to premium", () => {});
```

**Generic Pattern:** `should change [attribute] from [initial state] to [final state]`

## Rule 5: Describe Async Behavior Clearly

Include loading and result states for asynchronous operations.

```js
// ❌ Bad
it("should load data", () => {});
it("should handle API call", () => {});
it("should fetch user", () => {});

// ✅ Good
it("should show skeleton while loading data", () => {});
it("should display error message when API call fails", () => {});
it("should render profile after user data loads", () => {});
```

**Generic Pattern:** `should [verb] [expected outcome] [during/after] [async operation]`

## Rule 6: Name Error Cases Specifically

Be explicit about the type of error and what causes it.

```js
// ❌ Bad
it("should show error", () => {});
it("should handle invalid input", () => {});
it("should validate form", () => {});

// ✅ Good
it('should show "Invalid Card" when card number is wrong', () => {});
it('should display "Required" when password is empty', () => {});
it("should show network error when API is unreachable", () => {});
```

**Generic Pattern:** `should show [specific error message] when [error condition]`

## Rule 7: Use Business Language, Not Technical Terms

Write tests using domain language rather than implementation details.

```js
// ❌ Bad
it("should update state", () => {});
it("should dispatch action", () => {});
it("should modify DOM", () => {});

// ✅ Good
it("should save customer order", () => {});
it("should update cart total", () => {});
it("should mark order as delivered", () => {});
```

**Generic Pattern:** `should [business action] [business entity]`

## Rule 8: Include Important Preconditions

Specify conditions that affect the behavior being tested.

```js
// ❌ Bad
it("should enable button", () => {});
it("should show message", () => {});
it("should apply discount", () => {});

// ✅ Good
it("should enable checkout when cart has items", () => {});
it("should show free shipping when total exceeds $100", () => {});
it("should apply discount when user is premium member", () => {});
```

**Generic Pattern:** `should [expected behavior] when [precondition]`

## Rule 9: Name UI Feedback Tests from User Perspective

Describe visual changes as users would perceive them.

```js
// ❌ Bad
it("should set error class", () => {});
it("should toggle visibility", () => {});
it("should update styles", () => {});

// ✅ Good
it("should highlight search box in red when empty", () => {});
it("should show green checkmark when password is strong", () => {});
it("should disable submit button while processing", () => {});
```

**Generic Pattern:** `should [visual change] when [user action/condition]`

## Rule 10: Structure Complex Workflows Step by Step

Break down complex processes into clear steps.

```js
// ❌ Bad
describe("Checkout", () => {
  it("should process checkout", () => {});
  it("should handle shipping", () => {});
  it("should complete order", () => {});
});

// ✅ Good
describe("Checkout Process", () => {
  it("should first validate items are in stock", () => {});
  it("should then collect shipping address", () => {});
  it("should finally process payment", () => {});

  describe("after successful payment", () => {
    it("should display order confirmation", () => {});
    it("should send confirmation email", () => {});
  });
});
```

**Generic Pattern:**

```js
describe("[Complex Process]", () => {
  it("should first [initial step]", () => {});
  it("should then [next step]", () => {});
  it("should finally [final step]", () => {});

  describe("after [key milestone]", () => {
    it("should [follow-up action]", () => {});
  });
});
```

## Complete Example

Here's a comprehensive example showing how to combine all these rules:

```js
// ❌ Bad
describe("ShoppingCart", () => {
  it("test adding item", () => {});
  it("check total", () => {});
  it("handle checkout", () => {});
});

// ✅ Good
describe("ShoppingCart", () => {
  describe("when adding items", () => {
    it("should add item to cart when add button is clicked", () => {});
    it("should update total price immediately", () => {});
    it("should show item count badge", () => {});
  });

  describe("when cart is empty", () => {
    it("should display empty cart message", () => {});
    it("should disable checkout button", () => {});
  });

  describe("during checkout process", () => {
    it("should validate stock before proceeding", () => {});
    it("should show loading indicator while processing payment", () => {});
    it("should display success message after completion", () => {});
  });
});
```

## Test Name Checklist

Before committing your test, verify that its name:

- [ ] Starts with "should"
- [ ] Uses a clear action verb
- [ ] Specifies the trigger condition
- [ ] Uses business language
- [ ] Describes visible behavior
- [ ] Is specific enough for debugging
- [ ] Groups logically with related tests
