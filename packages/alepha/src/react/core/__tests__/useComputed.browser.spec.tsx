import { act, renderHook } from "@testing-library/react";
import { $atom, $computed, Alepha, z } from "alepha";
import type { ReactNode } from "react";
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
});
