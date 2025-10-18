# Testing Guidelines

1. **Analyze existing tests** - Before writing new tests, examine similar existing test files in the codebase to understand the established patterns, naming conventions, and testing approaches
2. **Follow Alepha conventions** - Use the same testing utilities, mocking patterns, and assertion styles found in existing tests
3. **Write comprehensive tests** - Cover happy paths, edge cases, error conditions, and boundary conditions
4. **Use Vitest effectively** - Leverage Vitest's features including describe blocks, test cases, mocks, and matchers consistent with existing usage
5. **Maintain consistency** - Ensure your tests match the style, structure, and organization of existing tests in similar modules

Key testing patterns to follow:
- Use descriptive test names that clearly state what is being tested
- Group related tests using `describe` blocks
- Follow the Arrange-Act-Assert pattern
- Mock dependencies appropriately using existing mocking patterns
- Test both success and failure scenarios
- Include edge cases and boundary conditions
- Use appropriate Vitest matchers and assertions
- Follow the existing file naming and organization conventions

Before writing tests:
1. Examine the code to be tested and understand its functionality
2. Look for similar existing test files to understand the established patterns
3. Identify all the scenarios that need testing (happy path, edge cases, errors)
4. Plan the test structure and organization

When writing tests:
- Use clear, descriptive test names
- Follow existing mocking and setup patterns
- Include comprehensive assertions
- Test all public methods and their various input scenarios
- Ensure tests are isolated and don't depend on each other
- Add comments for complex test scenarios when helpful

If you need to run test on browser like environment, filename must end with `.browser.spec.ts` or `.browser.spec.tsx`.
All tests must be written in TypeScript, in the `tests` directory, and use Vitest as the test runner with `yarn test`.

**Important Alepha Test Behaviors:**
- `Alepha.create()` automatically handles test lifecycle when `NODE_ENV=test` (Vitest/Jest environments)
- Test hooks (`beforeAll`, `afterAll`, `onTestFinished`) are automatically registered to start/stop Alepha
- Use `Alepha.with()` for service substitution - this is the preferred approach for mocking dependencies
- Substitution allows replacing any service with a different implementation without modifying the original code

Always prioritize consistency with existing test patterns over generic testing best practices. Your tests should feel like they were written by the same developer who wrote the existing tests in the codebase.

### Core Import Pattern
```typescript
import { expect, test } from "vitest";
import { Alepha, t } from "@alepha/core";
import { $descriptor } from "../src";
```

### Basic Test Structure

```typescript
import { describe } from "vitest";

describe("MyService", () => {
  it("should do something", async () => {
    const alepha = Alepha.create();
    class TestApp {
      // Define services, controllers, etc.
    }
    const app = alepha.inject(TestApp);
    await alepha.start();

    const result = await app.someMethod();
    expect(result).toBe("expectedValue");
  });
});
```

### Server Action Testing

```typescript
import { describe } from "vitest";

describe("BasicController", () => {
  it("should return greeting", async () => {
    class BasicController {
      hello = $action({
        handler: async ({ name }: { name: string }) => `hello ${name}`,
      });
    }

    const alepha = Alepha.create();
    const app = alepha.inject(BasicController);
    await alepha.start();

    const result = await app.hello({ name: "world" });
    expect(result).toBe("hello world");
  });
});
```

### Repository Testing

```typescript
import { afterEach, beforeEach, describe } from "vitest";

describe("MyRepository", () => {

  class MyEntity {
    id!: string;
    name!: string;
  }

  class MyRepository {
    entity = $entity(MyEntity);

    create = $action({
      handler: async (data: { name: string }) => {
        const item = await this.entity.create(data);
        return item;
      },
    });

    getById = $action({
      handler: async (id: string) => {
        const item = await this.entity.get(id);
        if (!item) throw new Error("Not found");
        return item;
      },
    });
  }

  const alepha = Alepha.create();
  const repo = alepha.inject(MyRepository);

  it("should create and retrieve entity", async () => {
    const created = await repo.create({ name: "test" });
    expect(created.name).toBe("test");

    const fetched = await repo.getById(created.id);
    expect(fetched.name).toBe("test");
  });

  // you can clear data after each test
  afterEach(() => repo.clear({ force: true }));
});
```

### Error Testing Patterns
```typescript
it("should throw on missing context", () => {
  class A {}
  class B {
    a = $inject(A);
  }

  expect(() => new B()).toThrow(MissingContextError);
});

it("should handle async errors", async () => {
  const app = alepha.inject(TestApp);
  await alepha.start();

  await expect(app.action.run({ params: { id: 999 } }))
    .rejects.toThrowError("User not found");
});
```

### React Component Testing
```typescript
it("should render hello with name", async ({ expect }) => {
  class App {
    hello = $page({
      path: "/hello/:name",
      schema: {
        params: t.object({
          name: t.text({ default: "world" }),
        }),
      },
      component: ({ name }) => `hello ${name}`,
    });
  }

  const app = Alepha.create().inject(App);

  expect(await app.hello.render().then(it => it.html)).toEqual("hello world");
  expect(
    await app.hello.render({ params: { name: "jack" } }).then(it => it.html)
  ).toEqual("hello jack");
});
```

### Service Substitution (Mocking Pattern)
```typescript
it("should use substituted service", ({ expect }) => {
  class BaseLogger {
    print(msg: string): string {
      return msg;
    }
  }

  class MockLogger extends BaseLogger {
    print(msg: string): string {
      return `[MOCK] ${msg}`;
    }
  }

  class App {
    logger = $inject(BaseLogger);
  }

  // Preferred approach: Use substitution instead of traditional mocking
  const alepha = Alepha.create().with({
    provide: BaseLogger,
    use: MockLogger,
  });

  const app = alepha.inject(App);
  expect(app.logger).toBeInstanceOf(MockLogger);
  expect(app.logger.print("Hello")).toBe("[MOCK] Hello");
});
```

### Testing with Automatic Lifecycle Management
```typescript
describe("Alepha handles lifecycle automatically in tests", async ({ expect }) => {
  // No need to manually call alepha.start() in test environment
  // Alepha.create() automatically sets up beforeAll/afterAll hooks
  class TestService {
    value = "test";
  }

  const alepha = Alepha.create(); // Auto-started in test env
  const service = alepha.inject(TestService);

  it("should have value", () => {
    expect(service.value).toBe("test");
    expect(alepha.isTest()).toBe(true);
  });
});
```

### Multiple Service Substitutions
```typescript
test("should substitute multiple services", async ({ expect }) => {
  class DatabaseProvider {
    query() { return "real data"; }
  }

  class CacheProvider {
    get() { return "cached data"; }
  }

  class MockDatabase extends DatabaseProvider {
    query() { return "mock data"; }
  }

  class MockCache extends CacheProvider {
    get() { return "mock cached"; }
  }

  class App {
    db = $inject(DatabaseProvider);
    cache = $inject(CacheProvider);
  }

  const alepha = Alepha.create()
    .with({ provide: DatabaseProvider, use: MockDatabase })
    .with({ provide: CacheProvider, use: MockCache });

  const app = alepha.inject(App);

  expect(app.db.query()).toBe("mock data");
  expect(app.cache.get()).toBe("mock cached");
});
```
