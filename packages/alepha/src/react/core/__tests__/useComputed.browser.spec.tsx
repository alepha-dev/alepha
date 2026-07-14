import { act, renderHook } from "@testing-library/react";
import { $atom, $computed, Alepha, type Computed, z } from "alepha";
import type { ReactNode } from "react";
import { useRef } from "react";
import { describe, expect, it } from "vitest";
import { AlephaContext } from "../contexts/AlephaContext.ts";
import { useComputed } from "../hooks/useComputed.ts";

const countAtom = $atom({
  name: "test.useComputed.count",
  schema: z.object({ value: z.number() }),
  default: { value: 1 },
});

const squared = $computed({
  name: "test.useComputed.squared",
  deps: [countAtom],
  get: (c) => c.value * c.value,
});

const otherAtom = $atom({
  name: "test.useComputed.other",
  schema: z.object({ value: z.number() }),
  default: { value: 5 },
});

const otherSquared = $computed({
  name: "test.useComputed.otherSquared",
  deps: [otherAtom],
  get: (o) => o.value + 100,
});

const cartAtom = $atom({
  name: "test.useComputed.cart",
  schema: z.object({
    items: z.array(z.object({ price: z.number() })),
  }),
  default: { items: [] },
});

const cartSummary = $computed({
  name: "test.useComputed.cartSummary",
  deps: [cartAtom],
  get: (c) => ({ count: c.items.length, items: c.items }),
});

describe("useComputed", () => {
  const setup = async () => {
    const alepha = Alepha.create();
    await alepha.start();

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    return { alepha, wrapper };
  };

  it("renders the derived value", async () => {
    const { wrapper } = await setup();
    const { result } = renderHook(() => useComputed(squared), { wrapper });
    expect(result.current).toBe(1);
  });

  it("updates when a dependency mutates", async () => {
    const { alepha, wrapper } = await setup();
    const { result } = renderHook(() => useComputed(squared), { wrapper });

    await act(async () => {
      alepha.store.set(countAtom, { value: 3 });
    });

    expect(result.current).toBe(9);
  });

  it("ignores mutations of unrelated keys", async () => {
    const { alepha, wrapper } = await setup();
    let renders = 0;

    renderHook(
      () => {
        renders++;
        return useComputed(squared);
      },
      { wrapper },
    );

    const before = renders;
    await act(async () => {
      alepha.store.set("test.useComputed.unrelated" as any, 42 as any);
    });

    expect(renders).toBe(before);
  });

  // The cache's entire reason to exist is referential stability for
  // object/array-returning computed values (the infinite-loop guard for
  // `useSyncExternalStore`). A number-returning computed can't tell a real
  // cache apart from no caching at all, because numbers are stable under
  // `Object.is` by value — these tests use an object-returning computed so
  // a naive `getSnapshot = () => alepha.store.get(target)` (no caching
  // mechanism whatsoever) would actually fail them.
  describe("referential stability of object/array-returning values", () => {
    it("returns the same reference across re-renders when no dependency changed", async () => {
      const { wrapper } = await setup();
      const { result, rerender } = renderHook(() => useComputed(cartSummary), {
        wrapper,
      });

      const first = result.current;
      rerender();

      expect(result.current).toBe(first);
    });

    it("returns a new reference once a dependency actually changes", async () => {
      const { alepha, wrapper } = await setup();
      const { result } = renderHook(() => useComputed(cartSummary), {
        wrapper,
      });

      const first = result.current;

      await act(async () => {
        alepha.store.set(cartAtom, { items: [{ price: 9 }] });
      });

      expect(result.current).not.toBe(first);
      expect(result.current.count).toBe(1);
    });
  });

  // Fix 1 regression: a mutation that lands in the window between the
  // initial render and the passive effect that subscribes to
  // `state:mutate` must still be reflected. A dirty-flag cache — set only
  // by that subscription's listener — can never learn about a mutation
  // that happened before the listener existed, so it would serve the
  // stale pre-mutation value forever (until some later, unrelated mutation
  // on the same key happened to fire). `MutateDuringRender` reproduces the
  // window deterministically: it is a sibling rendered (in the same
  // synchronous render pass) right after the `useComputed` consumer, so its
  // mutation always lands after `useComputed`'s first `getSnapshot()` call
  // but strictly before React commits and runs any effect — the exact race
  // described in the review.
  describe("mutation landing before the store subscribes", () => {
    const MutateDuringRender = (props: { alepha: Alepha }) => {
      const done = useRef(false);
      if (!done.current) {
        done.current = true;
        props.alepha.store.set(countAtom, { value: 3 });
      }
      return null;
    };

    it("reflects a mutation dispatched before the mutate listener attaches", async () => {
      const alepha = Alepha.create();
      await alepha.start();

      const wrapper = ({ children }: { children: ReactNode }) => (
        <AlephaContext.Provider value={alepha}>
          {children}
          <MutateDuringRender alepha={alepha} />
        </AlephaContext.Provider>
      );

      const { result } = renderHook(() => useComputed(squared), { wrapper });

      expect(result.current).toBe(9);
    });
  });

  // Fix 2 regression: swapping `target` for a different `Computed` across
  // renders must render the new target's value immediately — not the old
  // target's cached value, and not only once a mutation happens to touch
  // the new target's keys.
  describe("swapping targets", () => {
    it("renders the new target's value right after the swap", async () => {
      const { wrapper } = await setup();
      const initialProps: { target: Computed<number> } = { target: squared };
      const { result, rerender } = renderHook(
        (props: { target: Computed<number> }) => useComputed(props.target),
        { wrapper, initialProps },
      );

      expect(result.current).toBe(1);

      rerender({ target: otherSquared });

      expect(result.current).toBe(105);
    });
  });
});
