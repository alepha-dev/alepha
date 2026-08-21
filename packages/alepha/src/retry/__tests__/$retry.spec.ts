import { $pipeline, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { $retry } from "../index.ts";

describe("$retry", () => {
  let alepha: Alepha;
  let time: DateTimeProvider;

  beforeEach(() => {
    alepha = Alepha.create();
    time = alepha.inject(DateTimeProvider);
  });

  afterEach(async () => {
    await alepha.stop();
  });

  test("should still work after a stop/start cycle", async () => {
    // The app-level controller was created with `??=` and only ever aborted
    // on stop, never replaced — so after stop→start every retry threw
    // RetryCancelError immediately and the middleware was dead for the rest
    // of the process.
    class Dummy {
      calls = 0;
      work = $pipeline({
        use: [$retry({ max: 3, backoff: 0 })],
        handler: () => {
          this.calls++;
          return "ok";
        },
      });
    }

    const dummy = alepha.inject(Dummy);
    await alepha.start();

    expect(await dummy.work.run()).toBe("ok");

    await alepha.stop();
    await alepha.start();

    expect(await dummy.work.run()).toBe("ok");
    expect(dummy.calls).toBe(2);
  });

  test("should retry handler up to max retries", async () => {
    class Dummy {
      inc = 0;
      workRetry = $pipeline({
        use: [$retry({ max: 3 })],
        handler: (n: number, end: number) => {
          this.inc += n;
          if (this.inc < end) {
            throw new Error("Retry");
          }
          return this.inc;
        },
      });

      work = async (n: number, end: number) => {
        this.inc = 0;
        return await this.workRetry.run(n, end);
      };
    }

    const basic = alepha.inject(Dummy);

    expect(await basic.work(1, 2)).toBe(2);
    expect(await basic.work(1, 3)).toBe(3);
    await expect(() => basic.work(1, 4)).rejects.toThrow(Error);
  });

  test("should only retry when condition matches", async () => {
    class Dummy {
      inc = 0;
      workRetry = $pipeline({
        use: [
          $retry({
            max: 10,
            when: (err: Error) => err.message === "Retry1",
          }),
        ],
        handler: (n: number, end: number) => {
          this.inc += n;
          if (this.inc < end) {
            throw new Error(`Retry${this.inc}`);
          }
          return this.inc;
        },
      });

      async work(n: number, end: number) {
        this.inc = 0;
        return await this.workRetry.run(n, end);
      }
    }

    const basic = alepha.inject(Dummy);

    expect(await basic.work(1, 2)).toBe(2);
    await expect(() => basic.work(1, 3)).rejects.toThrow(Error);
  });

  test("should succeed on the first attempt", async () => {
    const handler = vi.fn().mockResolvedValue("success");
    const retryFunc = alepha.inject(
      class {
        retry = $pipeline({
          use: [$retry()],
          handler,
        });
      },
    ).retry;

    await expect(retryFunc.run()).resolves.toBe("success");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("should retry up to max attempts and then fail", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("Failed"));
    const onError = vi.fn();

    const retryFunc = alepha.inject(
      class {
        retry = $pipeline({
          use: [$retry({ max: 3, backoff: 0, onError })],
          handler,
        });
      },
    ).retry;

    await expect(retryFunc.run()).rejects.toThrow("Failed");
    expect(handler).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 1);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 2);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 3);
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
        retry = $pipeline({
          use: [$retry({ max: 4, backoff: 0 })],
          handler,
        });
      },
    ).retry;

    await expect(retryFunc.run()).resolves.toBe("success");
    expect(handler).toHaveBeenCalledTimes(3);
  });

  test("should respect maxDuration and time out", async () => {
    const handler = vi.fn(async () => {
      await time.wait(200);
      throw new Error("Failed");
    });

    const retryFunc = alepha.inject(
      class {
        retry = $pipeline({
          use: [$retry({ max: 5, maxDuration: [300, "ms"], backoff: 0 })],
          handler,
        });
      },
    ).retry;

    await expect(retryFunc.run()).rejects.toThrow(
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
        retry = $pipeline({
          use: [
            $retry({
              max: 5,
              backoff: 100,
              signal: abortController.signal,
            }),
          ],
          handler,
        });
      },
    ).retry;

    const promise = retryFunc.run();

    // Let the first attempt start
    await time.travel(100);

    // Abort during the first handler execution
    abortController.abort();

    await expect(promise).rejects.toThrow("Retry operation was cancelled.");

    // Handler was called once but never completed
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("should be cancellable by application shutdown", async () => {
    // Create a fresh alepha instance for this test
    const testAlepha = Alepha.create();

    const handler = vi.fn(async () => {
      // Throw immediately to trigger retry
      throw new Error("Failed");
    });

    const retryFunc = testAlepha.inject(
      class {
        retry = $pipeline({
          use: [$retry({ max: 10, backoff: 100 })],
          handler,
        });
      },
    ).retry;

    await testAlepha.start();

    // Start the retry operation
    const promise = retryFunc.run();

    // Give it a moment to start
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Stop the application which should abort all retries
    await testAlepha.stop();

    // The promise should reject with cancellation error
    await expect(promise).rejects.toThrow("Retry operation was cancelled.");

    // Handler should have been called at least once but not 10 times
    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls.length).toBeLessThan(10);
  });

  test("should not retry if `when` condition returns false", async () => {
    class CustomError extends Error {}
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new CustomError("Do not retry me"))
      .mockRejectedValue(new Error("Retry me"));

    const retryFunc = alepha.inject(
      class {
        retry = $pipeline({
          use: [
            $retry({
              max: 3,
              backoff: 0,
              when: (error) => !(error instanceof CustomError),
            }),
          ],
          handler,
        });
      },
    ).retry;

    await expect(retryFunc.run()).rejects.toThrow(CustomError);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
