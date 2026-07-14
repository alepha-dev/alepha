import { act, renderHook } from "@testing-library/react";
import { $atom, Alepha, z } from "alepha";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { AlephaContext } from "../contexts/AlephaContext.ts";
import { useSelector } from "../hooks/useSelector.ts";
import { shallowEqual } from "../utils/shallowEqual.ts";

const prefsAtom = $atom({
  name: "test.useSelector.prefs",
  schema: z.object({
    theme: z.string(),
    sidebar: z.object({ collapsed: z.boolean() }),
  }),
  default: { theme: "light", sidebar: { collapsed: false } },
});

describe("useSelector", () => {
  const setup = async () => {
    const alepha = Alepha.create();
    await alepha.start();

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );

    return { alepha, wrapper };
  };

  it("returns the selected slice", async () => {
    const { wrapper } = await setup();

    const { result } = renderHook(
      () => useSelector(prefsAtom, (s) => s.theme),
      { wrapper },
    );

    expect(result.current).toBe("light");
  });

  it("re-renders when the selected slice changes", async () => {
    const { alepha, wrapper } = await setup();

    const { result } = renderHook(
      () => useSelector(prefsAtom, (s) => s.theme),
      { wrapper },
    );

    await act(async () => {
      alepha.store.mut(prefsAtom, (s) => ({ ...s, theme: "dark" }));
    });

    expect(result.current).toBe("dark");
  });

  it("does not re-render when an unselected field changes", async () => {
    const { alepha, wrapper } = await setup();
    let renders = 0;

    renderHook(
      () => {
        renders++;
        return useSelector(prefsAtom, (s) => s.theme);
      },
      { wrapper },
    );

    const before = renders;
    await act(async () => {
      alepha.store.mut(prefsAtom, (s) => ({
        ...s,
        sidebar: { collapsed: true },
      }));
    });

    expect(renders).toBe(before);
  });

  it("suppresses re-renders for structurally equal object slices via shallowEqual", async () => {
    const { alepha, wrapper } = await setup();
    let renders = 0;

    const { result } = renderHook(
      () => {
        renders++;
        return useSelector(
          prefsAtom,
          (s) => ({ collapsed: s.sidebar.collapsed }),
          shallowEqual,
        );
      },
      { wrapper },
    );

    const first = result.current;
    const before = renders;

    await act(async () => {
      alepha.store.mut(prefsAtom, (s) => ({ ...s, theme: "dark" }));
    });

    expect(renders).toBe(before);
    expect(result.current).toBe(first);
  });
});
