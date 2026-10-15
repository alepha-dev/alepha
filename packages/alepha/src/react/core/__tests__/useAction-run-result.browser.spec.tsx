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
    return { wrapper };
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

  it("derives handled one way", ({ expect }) => {
    expect(ActionErrorPolicy.isHandled(new Error("x"))).toBe(false);
    expect(ActionErrorPolicy.isHandled(new Error("x"), () => {})).toBe(true);
    expect(
      ActionErrorPolicy.isHandled(
        Object.assign(new Error("x"), { shownInPlace: true }),
      ),
    ).toBe(true);
  });
});
