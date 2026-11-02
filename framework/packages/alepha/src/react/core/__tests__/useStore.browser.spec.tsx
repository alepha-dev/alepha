import { act, renderHook } from "@testing-library/react";
import { Alepha } from "alepha";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { AlephaContext } from "../contexts/AlephaContext.ts";
import { useStore } from "../hooks/useStore.ts";

describe("useStore", () => {
  const setup = async () => {
    const alepha = Alepha.create();
    await alepha.start();

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    return { alepha, wrapper };
  };

  it("reflects a mutation to the subscribed key", async () => {
    const { alepha, wrapper } = await setup();
    alepha.store.set("count", 1);

    const { result } = renderHook(() => useStore("count"), { wrapper });

    expect(result.current[0]).toBe(1);

    await act(async () => {
      alepha.store.set("count", 2);
    });

    expect(result.current[0]).toBe(2);
  });

  it("ignores mutations to other keys", async () => {
    const { alepha, wrapper } = await setup();
    alepha.store.set("count", 1);

    const { result } = renderHook(() => useStore("count"), { wrapper });

    await act(async () => {
      alepha.store.set("unrelated", 99);
    });

    expect(result.current[0]).toBe(1);
  });

  /**
   * The subscription used to be registered in a `[]`-deps effect and the value
   * seeded via `useState`, so a component that switches which key it watches
   * kept reading — and listening to — the ORIGINAL key forever.
   */
  it("re-reads the store when the target key changes", async () => {
    const { alepha, wrapper } = await setup();
    alepha.store.set("a", "value-a");
    alepha.store.set("b", "value-b");

    const { result, rerender } = renderHook(({ target }) => useStore(target), {
      wrapper,
      initialProps: { target: "a" },
    });

    expect(result.current[0]).toBe("value-a");

    rerender({ target: "b" });

    expect(result.current[0]).toBe("value-b");
  });

  it("re-subscribes when the target key changes", async () => {
    const { alepha, wrapper } = await setup();
    alepha.store.set("a", "value-a");
    alepha.store.set("b", "value-b");

    const { result, rerender } = renderHook(({ target }) => useStore(target), {
      wrapper,
      initialProps: { target: "a" },
    });

    rerender({ target: "b" });

    await act(async () => {
      alepha.store.set("b", "value-b2");
    });

    expect(result.current[0]).toBe("value-b2");
  });

  it("seeds the default value into the store", async () => {
    const { alepha, wrapper } = await setup();

    const { result } = renderHook(() => useStore("seeded", "hello"), {
      wrapper,
    });

    expect(result.current[0]).toBe("hello");
    expect(alepha.store.get("seeded")).toBe("hello");
  });

  it("writes through the setter", async () => {
    const { alepha, wrapper } = await setup();
    alepha.store.set("count", 1);

    const { result } = renderHook(() => useStore("count"), { wrapper });

    await act(async () => {
      result.current[1](5);
    });

    expect(alepha.store.get("count")).toBe(5);
    expect(result.current[0]).toBe(5);
  });
});
