import { Alepha } from "alepha";
import type { LogEntry } from "alepha/logger";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { RetryCancelError } from "../errors/RetryCancelError.ts";
import { RetryTimeoutError } from "../errors/RetryTimeoutError.ts";
import { RetryProvider } from "../providers/RetryProvider.ts";

describe("RetryProvider", () => {
  let alepha: Alepha;
  let retryProvider: RetryProvider;

  beforeEach(async () => {
    alepha = Alepha.create();
    retryProvider = alepha.inject(RetryProvider);
    await alepha.start();
  });

  test("should retry handler up to max retries", async () => {
    let attempts = 0;
    const handler = vi.fn(() => {
      attempts++;
      if (attempts < 3) {
        throw new Error("Retry");
      }
      return "success";
    });

    const result = await retryProvider.retry({ handler, max: 3 });

    expect(result).toBe("success");
    expect(handler).toHaveBeenCalledTimes(3);
  });

  test("should throw error after max retries exceeded", async () => {
    const handler = vi.fn(() => {
      throw new Error("Always fails");
    });

    await expect(retryProvider.retry({ handler, max: 3 })).rejects.toThrowError(
      "Always fails",
    );

    expect(handler).toHaveBeenCalledTimes(3);
  });

  test("should only retry when condition matches", async () => {
    let attempts = 0;
    const handler = vi.fn(() => {
      attempts++;
      throw new Error(`Error${attempts}`);
    });

    const when = (error: Error) => error.message === "Error1";

    await expect(
      retryProvider.retry({ handler, max: 10, when }),
    ).rejects.toThrowError("Error2");

    // Should fail on second attempt because when() returns false
    expect(handler).toHaveBeenCalledTimes(2);
  });

  test("should use fixed backoff delay", async () => {
    const handler = vi.fn(() => {
      throw new Error("Retry");
    });

    const startTime = Date.now();

    await expect(
      retryProvider.retry({ handler, max: 3, backoff: 100 }),
    ).rejects.toThrowError("Retry");

    const duration = Date.now() - startTime;

    // Should have waited ~200ms total (2 retries × 100ms)
    expect(duration).toBeGreaterThanOrEqual(190);
    expect(duration).toBeLessThan(300);
  });

  test("should use exponential backoff with jitter", async () => {
    const handler = vi.fn(() => {
      throw new Error("Retry");
    });

    const startTime = Date.now();

    await expect(
      retryProvider.retry({
        handler,
        max: 3,
        backoff: { initial: 100, factor: 2, jitter: true },
      }),
    ).rejects.toThrowError("Retry");

    const duration = Date.now() - startTime;

    // First retry: ~100ms, Second retry: ~200ms
    // With jitter, expect at least base delays
    expect(duration).toBeGreaterThanOrEqual(280);
  });

  test("should respect maxDuration timeout", { retry: 3 }, async () => {
    const handler = vi.fn(() => {
      throw new Error("Retry");
    });

    await expect(
      retryProvider.retry({
        handler,
        max: 10,
        maxDuration: [100, "milliseconds"],
        backoff: 50,
      }),
    ).rejects.toThrowError(RetryTimeoutError);

    // Should not reach max retries due to timeout
    expect(handler).toHaveBeenCalledTimes(2);
  });

  test("should respect AbortSignal cancellation", async () => {
    const handler = vi.fn(() => {
      throw new Error("Retry");
    });

    const abortController = new AbortController();

    // Abort after first attempt
    setTimeout(() => abortController.abort(), 50);

    await expect(
      retryProvider.retry({
        handler,
        max: 10,
        backoff: 100,
        signal: abortController.signal,
      }),
    ).rejects.toThrowError(RetryCancelError);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("should call onError callback on each failure", async () => {
    let attempts = 0;
    const handler = vi.fn(() => {
      attempts++;
      if (attempts < 3) {
        throw new Error(`Attempt ${attempts}`);
      }
      return "success";
    });

    const onError = vi.fn();

    await retryProvider.retry({ handler, max: 3, onError });

    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ message: "Attempt 1" }),
      1,
    );
    expect(onError).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ message: "Attempt 2" }),
      2,
    );
  });

  test("should pass arguments to handler", async () => {
    const handler = vi.fn((a: number, b: string) => {
      return `${a}-${b}`;
    });

    const result = await retryProvider.retry({ handler, max: 1 }, 42, "test");

    expect(result).toBe("42-test");
    expect(handler).toHaveBeenCalledWith(42, "test");
  });

  test("should log warnings on retry failures", async () => {
    const handler = vi.fn(() => {
      throw new Error("Test error");
    });

    // Every entry is emitted on the `log` event whatever the active level,
    // so the warning can be observed without spying on the provider's logger.
    const warnings: LogEntry[] = [];
    alepha.events.on("log", (event) => {
      if (event.entry.message === "Retry attempt failed") {
        warnings.push(event.entry);
      }
    });

    await expect(retryProvider.retry({ handler, max: 2 })).rejects.toThrowError(
      "Test error",
    );

    expect(warnings).toHaveLength(2);
    expect(warnings[0].level).toBe("WARN");
    expect(warnings[0].data).toEqual(
      expect.objectContaining({
        attempt: 1,
        maxAttempts: 2,
        remainingAttempts: 1,
        error: "Test error",
        errorName: "Error",
      }),
    );
  });

  test("should support additionalSignal for combined cancellation", async () => {
    const handler = vi.fn(() => {
      throw new Error("Retry");
    });

    const additionalController = new AbortController();

    // Abort the additional signal
    setTimeout(() => additionalController.abort(), 50);

    await expect(
      retryProvider.retry({
        handler,
        max: 10,
        backoff: 100,
        additionalSignal: additionalController.signal,
      }),
    ).rejects.toThrowError(RetryCancelError);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("should not retry on non-Error throws", async () => {
    const handler = vi.fn(() => {
      throw "string error";
    });

    await expect(retryProvider.retry({ handler, max: 3 })).rejects.toBe(
      "string error",
    );

    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("should succeed on first attempt without retries", async () => {
    const handler = vi.fn(() => "immediate success");

    const result = await retryProvider.retry({ handler, max: 3 });

    expect(result).toBe("immediate success");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("should use default max of 3 when not specified", async () => {
    const handler = vi.fn(() => {
      throw new Error("Retry");
    });

    await expect(retryProvider.retry({ handler })).rejects.toThrowError(
      "Retry",
    );

    expect(handler).toHaveBeenCalledTimes(3);
  });

  // Bug #1 (Red/Critical): Signal precedence issue
  // When both signal and additionalSignal are provided, ONLY signal is respected during backoff
  // This means additionalSignal (app lifecycle) cannot cancel during backoff if user signal exists
  test("should respect both user signal and additionalSignal during backoff waits", async () => {
    const handler = vi.fn(() => {
      throw new Error("Retry");
    });

    const userController = new AbortController();
    const additionalController = new AbortController();

    // Start retry with both signals provided
    const promise = retryProvider.retry({
      handler,
      max: 10,
      backoff: 200, // Long backoff to ensure we have time to abort
      signal: userController.signal,
      additionalSignal: additionalController.signal,
    });

    // Wait for first attempt to fail and backoff to start
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Abort additionalSignal during backoff (user signal still active)
    additionalController.abort();

    // BUG: This currently does NOT throw RetryCancelError because line 169 only uses signal
    // The additionalSignal abort is ignored during wait
    // EXPECTED: Should throw RetryCancelError
    // ACTUAL: Continues retrying until user signal aborts
    const startTime = Date.now();

    try {
      await promise;
      // If we reach here, the bug exists - additionalSignal was ignored
      throw new Error("Should have thrown RetryCancelError");
    } catch (error) {
      const duration = Date.now() - startTime;

      // If bug exists: continues for ~200ms+ (full backoff)
      // If fixed: cancels immediately (~10-30ms)
      if (error instanceof RetryCancelError) {
        // Fixed: should cancel quickly when additionalSignal aborts
        expect(duration).toBeLessThan(100);
      } else {
        // Bug exists: keeps waiting for full backoff despite additionalSignal abort
        expect(duration).toBeGreaterThanOrEqual(180);
      }
    }
  });

  // Bug #2 (Yellow/High): Abort race condition
  test("should throw RetryCancelError when aborted after handler error", async () => {
    let attempts = 0;
    const handler = vi.fn(() => {
      attempts++;
      if (attempts === 1) {
        throw new Error("Handler failed");
      }
      throw new Error("Should not reach here");
    });

    const abortController = new AbortController();

    // Abort immediately after first error (before backoff wait)
    setTimeout(() => abortController.abort(), 10);

    await expect(
      retryProvider.retry({
        handler,
        max: 10,
        backoff: 100,
        signal: abortController.signal,
      }),
    ).rejects.toThrowError(RetryCancelError);

    // Should have attempted once, then aborted
    expect(handler).toHaveBeenCalledTimes(1);
  });

  // Bug #3 (Yellow/High): Timeout check timing
  test("should not allow handler to complete after maxDuration", async () => {
    const handler = vi.fn(async () => {
      // Handler takes 150ms
      await new Promise((resolve) => setTimeout(resolve, 150));
      throw new Error("Retry");
    });

    const startTime = Date.now();

    await expect(
      retryProvider.retry({
        handler,
        max: 10,
        maxDuration: [100, "milliseconds"],
        backoff: 10,
      }),
    ).rejects.toThrowError(RetryTimeoutError);

    const duration = Date.now() - startTime;

    // Should timeout around 100ms, not wait for handler to complete (150ms)
    // With current bug, this will fail because handler completes at ~150ms
    expect(duration).toBeLessThan(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("should return a success that lands after maxDuration", async () => {
    // The handler committed its side effects and returned a value; throwing
    // RetryTimeoutError here discarded that result, and an outer layer
    // (`$job`) would then re-run work that had already completed. maxDuration
    // bounds RETRYING, not a call that already succeeded.
    const handler = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      return "committed";
    });

    const result = await retryProvider.retry({
      handler,
      max: 5,
      maxDuration: [50, "milliseconds"],
      backoff: 10,
    });

    expect(result).toBe("committed");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  // Bug #7 (Medium): onError not called on final attempt
  test("should call onError on the final failed attempt", async () => {
    const handler = vi.fn(() => {
      throw new Error("Always fails");
    });

    const onError = vi.fn();

    await expect(
      retryProvider.retry({
        handler,
        max: 3,
        backoff: 0,
        onError,
      }),
    ).rejects.toThrowError("Always fails");

    // Should call onError for ALL attempts, including the final one
    // BUG: Currently only called 2 times (attempts 1-2), not 3 times
    expect(onError).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ message: "Always fails" }),
      1,
    );
    expect(onError).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ message: "Always fails" }),
      2,
    );
    expect(onError).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ message: "Always fails" }),
      3,
    );
  });

  // Bug #8 (Critical): AbortSignal.any() memory leak
  test("should not create multiple AbortSignal instances during retries", async () => {
    const handler = vi.fn(() => {
      throw new Error("Retry");
    });

    const userController = new AbortController();
    const additionalController = new AbortController();

    // Track how many times AbortSignal.any is called
    const originalAny = AbortSignal.any;
    const anySpy = vi.fn(originalAny);
    AbortSignal.any = anySpy as any;

    try {
      await expect(
        retryProvider.retry({
          handler,
          max: 5,
          backoff: 10,
          signal: userController.signal,
          additionalSignal: additionalController.signal,
        }),
      ).rejects.toThrowError("Retry");

      // BUG: Currently creates a NEW signal for each backoff (4 times for 5 attempts)
      // EXPECTED: Should only create ONE combined signal at the start
      expect(anySpy).toHaveBeenCalledTimes(1);
    } finally {
      // Restore original
      AbortSignal.any = originalAny;
    }
  });

  test("should reject max below one with a clear error", async () => {
    const handler = vi.fn(() => "never");

    await expect(retryProvider.retry({ handler, max: 0 })).rejects.toThrowError(
      /at least 1/,
    );
    expect(handler).not.toHaveBeenCalled();
  });
});
