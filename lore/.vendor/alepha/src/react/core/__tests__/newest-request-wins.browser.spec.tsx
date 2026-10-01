import { act, renderHook, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import type { ReactNode } from "react";
import { describe, it } from "vitest";

import { AlephaContext } from "../contexts/AlephaContext.ts";
import { useAction } from "../hooks/useAction.ts";
import { useQuery } from "../hooks/useQuery.ts";
import { AlephaReact } from "../index.ts";

/**
 * A request whose answer the test hands over when it chooses.
 */
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * #Q2517: an older response used to win over a newer request.
 */
describe("the newest request wins", () => {
  const boot = async () => {
    const alepha = Alepha.create().with(AlephaDateTime).with(AlephaReact);
    await alepha.start();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );
    return { wrapper };
  };

  it("lets a debounced run supersede the one still in flight", async ({
    expect,
  }) => {
    const { wrapper } = await boot();
    const pending: Record<string, ReturnType<typeof deferred<string>>> = {};
    const answered: string[] = [];

    const { result } = renderHook(
      () =>
        useAction<[string], string>(
          {
            debounce: 10,
            handler: (query) => {
              pending[query] = deferred<string>();
              return pending[query].promise;
            },
            onSuccess: (value) => {
              answered.push(value);
            },
          },
          [],
        ),
      { wrapper },
    );

    // "ab" goes out and hangs: slower than the debounce.
    void result.current.run("ab");
    await sleep(30);
    expect(pending.ab).toBeDefined();

    // "abc" is typed while "ab" is still in flight. It used to be dropped
    // by the double-submit guard, so the results stayed "ab"'s.
    void result.current.run("abc");
    await sleep(30);
    expect(pending.abc).toBeDefined();

    await act(async () => {
      pending.abc.resolve("results for abc");
      pending.ab.resolve("results for ab");
      await sleep(10);
    });

    expect(answered).toEqual(["results for abc"]);
  });

  it("writes a late answer under the key it was asked for, not the key on screen", async ({
    expect,
  }) => {
    const { wrapper } = await boot();
    const pending: Record<string, ReturnType<typeof deferred<string>>> = {};

    const { result, rerender } = renderHook(
      ({ key }: { key: string }) =>
        useQuery(
          {
            key: ["newest-wins", key],
            staleTime: [1, "minute"],
            handler: () => {
              pending[key] = deferred<string>();
              return pending[key].promise;
            },
          },
          [key],
        ),
      { wrapper, initialProps: { key: "k1" } },
    );

    await waitFor(() => expect(pending.k1).toBeDefined());
    await act(async () => {
      pending.k1.resolve("data for k1");
      await sleep(5);
    });
    await waitFor(() => expect(result.current.data).toBe("data for k1"));

    // To k2, which hangs, then straight back to a still-fresh k1: no run
    // starts for k1, so nothing supersedes k2's request.
    rerender({ key: "k2" });
    await waitFor(() => expect(pending.k2).toBeDefined());
    rerender({ key: "k1" });
    expect(result.current.data).toBe("data for k1");

    // k2 answers late. It used to be written under k1, the key on screen.
    await act(async () => {
      pending.k2.resolve("data for k2");
      await sleep(10);
    });
    expect(result.current.data).toBe("data for k1");

    rerender({ key: "k2" });
    await waitFor(() => expect(result.current.data).toBe("data for k2"));
  });
});
