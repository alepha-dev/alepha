import { $pipeline, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, test } from "vitest";

import { $circuit } from "../primitives/$circuit.ts";

// -----------------------------------------------------------------------------------------------------------------
// $circuit — core behavior
// -----------------------------------------------------------------------------------------------------------------

describe("$circuit", () => {
  test("calls pass through when circuit is closed", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [$circuit({ threshold: 3, reset: [1, "seconds"] })],
        handler: async (x: number) => x * 2,
      });
    }

    const svc = alepha.inject(TestService);
    expect(await svc.fn(5)).toBe(10);
  });

  test("failures below threshold keep circuit closed", async ({ expect }) => {
    const alepha = Alepha.create();
    let attempt = 0;

    class TestService {
      fn = $pipeline({
        use: [$circuit({ threshold: 3, reset: [1, "seconds"] })],
        handler: async () => {
          attempt++;
          if (attempt <= 2) throw new Error("Fail");
          return "ok";
        },
      });
    }

    const svc = alepha.inject(TestService);

    // 2 failures (below threshold of 3)
    await expect(svc.fn()).rejects.toThrowError("Fail");
    await expect(svc.fn()).rejects.toThrowError("Fail");

    // Circuit still closed — next call goes through
    expect(await svc.fn()).toBe("ok");
  });

  test("failures at threshold open the circuit", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [$circuit({ threshold: 2, reset: [10, "seconds"] })],
        handler: async () => {
          throw new Error("Fail");
        },
      });
    }

    const svc = alepha.inject(TestService);

    // 2 failures → opens circuit
    await expect(svc.fn()).rejects.toThrowError("Fail");
    await expect(svc.fn()).rejects.toThrowError("Fail");

    // Circuit is open — handler not called, immediate rejection
    await expect(svc.fn()).rejects.toThrowError("$circuit: circuit is open");
  });

  test("open circuit rejects without calling handler", async ({ expect }) => {
    const alepha = Alepha.create();
    let handlerCalls = 0;

    class TestService {
      fn = $pipeline({
        use: [$circuit({ threshold: 1, reset: [10, "seconds"] })],
        handler: async () => {
          handlerCalls++;
          throw new Error("Fail");
        },
      });
    }

    const svc = alepha.inject(TestService);

    // 1 failure → opens circuit
    await expect(svc.fn()).rejects.toThrowError("Fail");
    expect(handlerCalls).toBe(1);

    // Open circuit — handler never called
    await expect(svc.fn()).rejects.toThrowError("$circuit: circuit is open");
    expect(handlerCalls).toBe(1); // Still 1
  });

  test("circuit transitions to half-open after reset duration", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const dt = alepha.inject(DateTimeProvider);
    let attempt = 0;

    class TestService {
      fn = $pipeline({
        use: [$circuit({ threshold: 1, reset: [50, "milliseconds"] })],
        handler: async () => {
          attempt++;
          if (attempt === 1) throw new Error("Fail");
          return "recovered";
        },
      });
    }

    const svc = alepha.inject(TestService);

    // Trip the circuit
    await expect(svc.fn()).rejects.toThrowError("Fail");

    // Travel past reset window
    await dt.travel([60, "milliseconds"]);

    // Half-open → probe succeeds → circuit closes
    expect(await svc.fn()).toBe("recovered");
  });

  test("half-open failure re-opens the circuit", async ({ expect }) => {
    const alepha = Alepha.create();
    const dt = alepha.inject(DateTimeProvider);

    class TestService {
      fn = $pipeline({
        use: [$circuit({ threshold: 1, reset: [50, "milliseconds"] })],
        handler: async () => {
          throw new Error("Still failing");
        },
      });
    }

    const svc = alepha.inject(TestService);

    // Trip the circuit
    await expect(svc.fn()).rejects.toThrowError("Still failing");

    // Travel past reset window
    await dt.travel([60, "milliseconds"]);

    // Half-open → probe fails → re-opens
    await expect(svc.fn()).rejects.toThrowError("Still failing");

    // Circuit is open again
    await expect(svc.fn()).rejects.toThrowError("$circuit: circuit is open");
  });

  test("success resets failure counter", async ({ expect }) => {
    const alepha = Alepha.create();
    let attempt = 0;

    class TestService {
      fn = $pipeline({
        use: [$circuit({ threshold: 3, reset: [1, "seconds"] })],
        handler: async () => {
          attempt++;
          // Fail on 1, 2, succeed on 3, fail on 4, 5
          if (attempt <= 2 || attempt >= 4) throw new Error("Fail");
          return "ok";
        },
      });
    }

    const svc = alepha.inject(TestService);

    // 2 failures
    await expect(svc.fn()).rejects.toThrowError("Fail");
    await expect(svc.fn()).rejects.toThrowError("Fail");

    // Success resets counter
    expect(await svc.fn()).toBe("ok");

    // 2 more failures — still below threshold (counter was reset)
    await expect(svc.fn()).rejects.toThrowError("Fail");
    await expect(svc.fn()).rejects.toThrowError("Fail");

    // Circuit still closed (2 < 3)
    // Next failure will open it
    await expect(svc.fn()).rejects.toThrowError("Fail");
    await expect(svc.fn()).rejects.toThrowError("$circuit: circuit is open");
  });

  test("handler return value is preserved", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [$circuit({ threshold: 3, reset: [1, "seconds"] })],
        handler: async () => ({ data: [1, 2, 3] }),
      });
    }

    const svc = alepha.inject(TestService);
    expect(await svc.fn()).toEqual({ data: [1, 2, 3] });
  });

  test("handler arguments are passed through", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [$circuit({ threshold: 3, reset: [1, "seconds"] })],
        handler: async (a: number, b: number) => a + b,
      });
    }

    const svc = alepha.inject(TestService);
    expect(await svc.fn(3, 4)).toBe(7);
  });
});

// -----------------------------------------------------------------------------------------------------------------
// $circuit — metadata
// -----------------------------------------------------------------------------------------------------------------

describe("$circuit metadata", () => {
  test("has middleware metadata", ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [$circuit({ threshold: 5, reset: [30, "seconds"] })],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    const meta = svc.fn.middlewares;
    expect(meta).toHaveLength(1);
    expect(meta[0].name).toBe("$circuit");
  });
});
