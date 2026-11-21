import { renderHook } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { act, type ReactNode } from "react";
import { describe, it } from "vitest";

import { AlephaContext } from "../contexts/AlephaContext.ts";
import { type RunResult, useAction } from "../hooks/useAction.ts";
import { ActionErrorPolicy } from "../services/ActionErrorPolicy.ts";

/**
 * `run()` never rejects and says what happened (#Q2657): a value, an error,
 * a call dropped while one was in flight, or one aborted.
 */
describe("useAction RunResult", () => {
  const boot = async () => {
    const alepha = Alepha.create().with(AlephaDateTime);
    await alepha.start();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );
    return { alepha, wrapper };
  };

  it("resolves the error instead of rejecting", async ({ expect }) => {
    const { wrapper } = await boot();
    const failure = new Error("nope");
    const { result } = renderHook(
      () =>
        useAction(
          {
            handler: async () => {
              throw failure;
            },
            onError: () => {},
          },
          [],
        ),
      { wrapper },
    );

    let run: RunResult<void> | undefined;
    await act(async () => {
      run = await result.current.run();
    });

    expect(run).toEqual({ ok: false, reason: "error", error: failure });
  });

  it("drops a call made while one is in flight", async ({ expect }) => {
    const { wrapper } = await boot();
    let release: () => void = () => {};
    const { result } = renderHook(
      () =>
        useAction(
          {
            handler: () =>
              new Promise<string>((resolve) => {
                release = () => resolve("first");
              }),
          },
          [],
        ),
      { wrapper },
    );

    let first: Promise<RunResult<string>> | undefined;
    let second: RunResult<string> | undefined;
    await act(async () => {
      first = result.current.run();
      second = await result.current.run();
      release();
    });

    expect(second).toEqual({ ok: false, reason: "dropped" });
    expect(await first).toEqual({ ok: true, value: "first" });
  });

  it("reports an aborted run, and a debounced call a newer one replaced", async ({
    expect,
  }) => {
    const { wrapper } = await boot();
    const { result } = renderHook(
      () =>
        useAction(
          {
            handler: async (_ctx, query: string) => query,
            debounce: 20,
          },
          [],
        ),
      { wrapper },
    );

    let replaced: RunResult<string> | undefined;
    let cancelled: RunResult<string> | undefined;
    await act(async () => {
      const older = result.current.run("a");
      const newer = result.current.run("ab");
      replaced = await older;
      result.current.cancel();
      cancelled = await newer;
    });

    expect(replaced).toEqual({ ok: false, reason: "dropped" });
    expect(cancelled).toEqual({ ok: false, reason: "aborted" });
  });

  it("resolves when onError itself throws, and reports that second failure unhandled", async ({
    expect,
  }) => {
    const { alepha, wrapper } = await boot();
    const seen: Array<{ message: string; handled?: boolean }> = [];
    alepha.events.on("react:action:error", (event) => {
      seen.push({ message: event.error.message, handled: event.handled });
    });
    const { result } = renderHook(
      () =>
        useAction(
          {
            handler: async () => {
              throw new Error("boom");
            },
            onError: () => {
              throw new Error("onError threw");
            },
          },
          [],
        ),
      { wrapper },
    );

    let run: RunResult<void> | undefined;
    await act(async () => {
      run = await result.current.run();
    });

    expect(run).toMatchObject({ ok: false, reason: "error" });
    expect(
      run?.ok === false && run.reason === "error" && run.error.message,
    ).toBe("boom");
    expect(result.current.loading).toBe(false);
    expect(seen).toEqual([
      { message: "boom", handled: true },
      { message: "onError threw", handled: false },
    ]);
  });

  it("resolves the error when a react:action:error listener throws", async ({
    expect,
  }) => {
    const { alepha, wrapper } = await boot();
    alepha.events.on("react:action:error", () => {
      throw new Error("listener threw");
    });
    const failure = new Error("boom");
    const { result } = renderHook(
      () =>
        useAction(
          {
            handler: async () => {
              throw failure;
            },
          },
          [],
        ),
      { wrapper },
    );

    let run: RunResult<void> | undefined;
    await act(async () => {
      run = await result.current.run();
    });

    expect(run).toEqual({ ok: false, reason: "error", error: failure });
  });

  it("keeps a saved write ok when a react:action:success listener throws", async ({
    expect,
  }) => {
    const { alepha, wrapper } = await boot();
    alepha.events.on("react:action:success", () => {
      throw new Error("success listener threw");
    });
    let saved = 0;
    const succeeded: string[] = [];
    const { result } = renderHook(
      () =>
        useAction(
          {
            handler: async () => {
              saved++;
              return "saved";
            },
            onSuccess: (value) => {
              succeeded.push(value);
            },
          },
          [],
        ),
      { wrapper },
    );

    let run: RunResult<string> | undefined;
    await act(async () => {
      run = await result.current.run();
    });

    expect(saved).toBe(1);
    expect(run).toEqual({ ok: true, value: "saved" });
    expect(succeeded).toEqual(["saved"]);
    expect(result.current.error).toBeUndefined();
  });

  it("resolves the value when a react:action:end listener throws", async ({
    expect,
  }) => {
    const { alepha, wrapper } = await boot();
    alepha.events.on("react:action:end", () => {
      throw new Error("end listener threw");
    });
    const { result } = renderHook(
      () => useAction({ handler: async () => "saved" }, []),
      { wrapper },
    );

    let run: RunResult<string> | undefined;
    await act(async () => {
      run = await result.current.run();
    });

    expect(run).toEqual({ ok: true, value: "saved" });
  });

  it("reports a failure that lands after cancel() as aborted, with no error", async ({
    expect,
  }) => {
    const { alepha, wrapper } = await boot();
    const errors: string[] = [];
    alepha.events.on("react:action:error", (event) => {
      errors.push(event.error.message);
    });
    let fail: (error: Error) => void = () => {};
    const { result } = renderHook(
      () =>
        useAction(
          {
            // Ignores its signal: the rejection is the handler's own.
            handler: () =>
              new Promise<string>((_resolve, reject) => {
                fail = reject;
              }),
          },
          [],
        ),
      { wrapper },
    );

    let pending: Promise<RunResult<string>> | undefined;
    await act(async () => {
      pending = result.current.run();
      await Promise.resolve();
    });
    act(() => result.current.cancel());
    let run: RunResult<string> | undefined;
    await act(async () => {
      fail(new Error("late failure"));
      run = await pending;
    });

    expect(run).toEqual({ ok: false, reason: "aborted" });
    expect(errors).toEqual([]);
    expect(result.current.error).toBeUndefined();
  });

  it("derives handled one way", ({ expect }) => {
    expect(ActionErrorPolicy.isHandled(new Error("x"))).toBe(false);
    expect(ActionErrorPolicy.isHandled(new Error("x"), () => {})).toBe(true);
    // A form refusal naming a field is shown under it; one for the whole
    // form is not.
    expect(
      ActionErrorPolicy.isHandled(
        Object.assign(new Error("x"), {
          name: "FORM_VALIDATION",
          data: { path: "/email" },
        }),
      ),
    ).toBe(true);
    expect(
      ActionErrorPolicy.isHandled(
        Object.assign(new Error("x"), {
          name: "FORM_VALIDATION",
          data: { path: "" },
        }),
      ),
    ).toBe(false);
  });
});
