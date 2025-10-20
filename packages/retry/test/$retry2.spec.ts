import { Alepha } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { $retry } from "../src/descriptors/$retry.ts";

describe("@alepha/retry", () => {
  let alepha: Alepha;
  let time: DateTimeProvider;

  beforeEach(() => {
    alepha = Alepha.create();
    time = alepha.inject(DateTimeProvider);
  });

  afterEach(async () => {
    await alepha.stop();
  });

  test("should succeed on the first attempt", async () => {
    const handler = vi.fn().mockResolvedValue("success");
    const retryFunc = alepha.inject(
      class {
        retry = $retry({ handler });
      },
    ).retry;

    await expect(retryFunc()).resolves.toBe("success");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("should retry up to max attempts and then fail", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("Failed"));
    const onError = vi.fn();

    const retryFunc = alepha.inject(
      class {
        retry = $retry({ handler, max: 3, backoff: 0, onError });
      },
    ).retry;

    await expect(retryFunc()).rejects.toThrow("Failed");
    expect(handler).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(2); // onError is called for failed attempts before the last one
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 1);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 2);
  });

  test("should succeed after a few failed attempts", async () => {
    let attempt = 0;
    const handler = vi.fn(() => {
      attempt++;
      if (attempt < 3) {
        return Promise.reject(new Error("Try again"));
      }
      return Promise.resolve("success");
    });

    const retryFunc = alepha.inject(
      class {
        retry = $retry({ handler, max: 4, backoff: 0 });
      },
    ).retry;

    await expect(retryFunc()).resolves.toBe("success");
    expect(handler).toHaveBeenCalledTimes(3);
  });

  test("should respect maxDuration and time out", async () => {
    const handler = vi.fn(async () => {
      await time.wait(200);
      throw new Error("Failed");
    });

    const retryFunc = alepha.inject(
      class {
        retry = $retry({
          handler,
          max: 5,
          maxDuration: [300, "ms"],
          backoff: 0,
        });
      },
    ).retry;

    await expect(retryFunc()).rejects.toThrow(
      "Retry operation timed out after 300ms.",
    );
    expect(handler).toHaveBeenCalledTimes(2);
  });

  test("should be cancellable with an AbortSignal", async () => {
    const handler = vi.fn(async () => {
      await time.wait(500); // Long delay
      throw new Error("Failed");
    });

    const abortController = new AbortController();
    const retryFunc = alepha.inject(
      class {
        retry = $retry({
          handler,
          max: 5,
          backoff: 100,
          signal: abortController.signal,
        });
      },
    ).retry;

    const promise = retryFunc();

    // Let the first attempt start
    await time.travel(100);

    // Abort during the first handler execution
    abortController.abort();

    await expect(promise).rejects.toThrow("Retry operation was cancelled.");

    // Handler was called once but never completed
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("should be cancellable by application shutdown", async () => {
    const alepha = Alepha.create();

    const handler = vi.fn(async () => {
      await time.wait(500); // Long delay
      throw new Error("Failed");
    });

    const retryFunc = alepha.inject(
      class {
        retry = $retry({ handler, max: 5, backoff: 100 });
      },
    ).retry;

    await alepha.start();

    const promise = retryFunc();

    //await time.travel(100);

    // Simulate application stop, which should trigger the internal abort controller
    await alepha.stop();

    await expect(promise).rejects.toThrow("Retry operation was cancelled.");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("should not retry if `when` condition returns false", async () => {
    class CustomError extends Error {}
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new CustomError("Do not retry me"))
      .mockRejectedValue(new Error("Retry me"));

    const retryFunc = alepha.inject(
      class {
        retry = $retry({
          handler,
          max: 3,
          backoff: 0,
          when: (error) => !(error instanceof CustomError),
        });
      },
    ).retry;

    await expect(retryFunc()).rejects.toThrow(CustomError);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
