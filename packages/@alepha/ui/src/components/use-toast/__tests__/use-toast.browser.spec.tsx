import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useToast } from "../use-toast.tsx";

describe("useToast", () => {
  it("returns the same object across re-renders", () => {
    // Consumers put the returned object in useCallback/useEffect dependency
    // arrays. If a render produces a fresh object, every one of those
    // callbacks changes identity on every render, and an effect that both
    // depends on such a callback and sets state loops forever — each fetch
    // re-triggers itself. This is exactly what made the Epic page spam
    // /api/_batch in production.
    const { result, rerender } = renderHook(() => useToast());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
