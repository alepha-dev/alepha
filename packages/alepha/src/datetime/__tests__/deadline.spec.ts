import { AbortedError, Alepha, TimeoutError } from "alepha";
import { describe, it } from "vitest";

import { DateTimeProvider } from "../index.ts";

describe("DateTimeProvider.deadline", () => {
  it("returns the result when fn completes in time", async ({ expect }) => {
    const dt = Alepha.create().inject(DateTimeProvider);

    await expect(dt.deadline(async () => "done", [1, "seconds"])).resolves.toBe(
      "done",
    );
  });

  it("rejects with a TimeoutError under travel(), even when fn ignores its signal", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const dt = alepha.inject(DateTimeProvider);
    dt.pause();
    let inner: AbortSignal | undefined;

    const promise = dt.deadline(async () => {
      inner = alepha.context.signal;
      await dt.wait([10, "minutes"]);
      return "done";
    }, [5, "minutes"]);
    const settled = promise.catch((error: unknown) => error);

    await dt.travel([5, "minutes"]);
    const error = await settled;

    expect(error).toBeInstanceOf(TimeoutError);
    expect((error as TimeoutError).data).toEqual({
      status: 503,
      timeout: 300_000,
    });
    expect((error as TimeoutError & { status: number }).status).toBe(503);
    expect((error as Error).message).toBe("Timed out after 300 s");
    expect(inner?.aborted).toBe(true);
    expect(inner?.reason).toBe(error);
    // A timeout is a failure, never classified as an abort.
    expect(alepha.context.isAbortError(error, inner)).toBe(false);
  });

  it("runs fn under a child of the ambient signal and restores the parent after", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const dt = alepha.inject(DateTimeProvider);
    const parent = new AbortController();
    let seen: AbortSignal | undefined;
    let argument: AbortSignal | undefined;

    await alepha.context.run(() =>
      alepha.context.withSignal(parent.signal, async () => {
        const outer = alepha.context.signal;
        await dt.deadline(
          async (signal) => {
            argument = signal;
            seen = alepha.context.signal;
          },
          [1, "minutes"],
        );
        expect(alepha.context.signal).toBe(outer);
      }),
    );

    expect(seen).toBeDefined();
    expect(seen).not.toBe(parent.signal);
    expect(argument?.aborted).toBe(false);
  });

  it("a parent abort reaches fn's signal, with the parent's reason", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const dt = alepha.inject(DateTimeProvider);
    const parent = new AbortController();
    let inner: AbortSignal | undefined;

    await alepha.context.run(() =>
      alepha.context.withSignal(parent.signal, () =>
        dt.deadline(async () => {
          inner = alepha.context.signal;
          parent.abort(new AbortedError("Client disconnected"));
        }, [1, "minutes"]),
      ),
    );

    expect(inner?.aborted).toBe(true);
    expect(inner?.reason).toBeInstanceOf(AbortedError);
    expect(inner?.reason).not.toBeInstanceOf(TimeoutError);
  });

  it("clears its timer once fn settles", async ({ expect }) => {
    const alepha = Alepha.create();
    const dt = alepha.inject(DateTimeProvider);
    dt.pause();
    let inner: AbortSignal | undefined;

    await dt.deadline(async () => {
      inner = alepha.context.signal;
    }, [5, "minutes"]);
    await dt.travel([10, "minutes"]);

    expect(inner?.aborted).toBe(false);
  });

  it.for([
    ["undefined", undefined],
    ["false", false],
    ["0", 0],
  ] as const)(
    "%s means no deadline: fn runs under the current signal",
    async ([, duration], { expect }) => {
      const alepha = Alepha.create();
      const dt = alepha.inject(DateTimeProvider);
      const parent = new AbortController();
      let outer: AbortSignal | undefined;
      let seen: AbortSignal | undefined;
      let argument: AbortSignal | undefined;

      await alepha.context.run(() =>
        alepha.context.withSignal(parent.signal, () => {
          outer = alepha.context.signal;
          return dt.deadline(async (signal) => {
            argument = signal;
            seen = alepha.context.signal;
          }, duration);
        }),
      );

      expect(seen).toBe(outer);
      expect(argument).toBe(outer);
    },
  );
});
