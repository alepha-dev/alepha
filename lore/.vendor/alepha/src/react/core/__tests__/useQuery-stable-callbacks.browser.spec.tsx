import { renderHook, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaContext } from "alepha/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { useQuery } from "../hooks/useQuery.ts";

describe("useQuery callback identity", () => {
  const wrapper = (alepha: Alepha) => (props: { children: ReactNode }) => (
    <AlephaContext.Provider value={alepha}>
      {props.children}
    </AlephaContext.Provider>
  );

  it("should keep refetch and cancel stable across re-renders", async () => {
    // `useQuery` passes a fresh inline `onSuccess` to `useAction` on every
    // render, and `executeAction` listed the callbacks in its deps — so
    // `run`/`refetch`/`cancel` were rebuilt each render. Any consumer that
    // depends on one (`useEffect(..., [refetch])`, a memoised child) churned
    // on every parent render, and an effect that calls `refetch()` looped.
    const alepha = Alepha.create().with(AlephaDateTime);
    await alepha.start();

    const { result, rerender } = renderHook(
      () => useQuery({ handler: async () => 42 }, []),
      { wrapper: wrapper(alepha) },
    );

    await waitFor(() => {
      expect(result.current.data).toBe(42);
    });

    const refetch = result.current.refetch;
    const cancel = result.current.cancel;

    rerender();
    rerender();

    expect(result.current.refetch).toBe(refetch);
    expect(result.current.cancel).toBe(cancel);
  });

  it("should call the latest onSuccess, not the one from the first render", async () => {
    // The flip side of holding callbacks in refs: they must not go stale.
    const alepha = Alepha.create().with(AlephaDateTime);
    await alepha.start();

    const seen: string[] = [];
    let label = "first";

    const { result, rerender } = renderHook(
      () =>
        useQuery(
          {
            handler: async () => 1,
            onSuccess: () => {
              seen.push(label);
            },
          },
          [],
        ),
      { wrapper: wrapper(alepha) },
    );

    await waitFor(() => {
      expect(seen).toEqual(["first"]);
    });

    label = "second";
    rerender();
    await result.current.refetch();

    await waitFor(() => {
      expect(seen).toEqual(["first", "second"]);
    });
  });
});
