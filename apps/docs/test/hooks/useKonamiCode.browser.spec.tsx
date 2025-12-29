import { renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useKonamiCode } from "../../src/hooks/useKonamiCode.ts";

describe("useKonamiCode", () => {
  const KONAMI_SEQUENCE = [
    "ArrowUp",
    "ArrowUp",
    "ArrowDown",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "ArrowLeft",
    "ArrowRight",
    "b",
    "a",
  ];

  const pressKey = (key: string) => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key }));
  };

  const pressSequence = (keys: string[]) => {
    for (const key of keys) {
      pressKey(key);
    }
  };

  test("calls callback when full Konami code is entered", () => {
    const callback = vi.fn();
    renderHook(() => useKonamiCode(callback));

    pressSequence(KONAMI_SEQUENCE);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  test("does not call callback on partial sequence", () => {
    const callback = vi.fn();
    renderHook(() => useKonamiCode(callback));

    // Press only first 5 keys
    pressSequence(KONAMI_SEQUENCE.slice(0, 5));

    expect(callback).not.toHaveBeenCalled();
  });

  test("does not call callback on wrong sequence", () => {
    const callback = vi.fn();
    renderHook(() => useKonamiCode(callback));

    pressSequence(["ArrowDown", "ArrowDown", "ArrowUp", "ArrowUp"]);

    expect(callback).not.toHaveBeenCalled();
  });

  test("is case-insensitive for letter keys", () => {
    const callback = vi.fn();
    renderHook(() => useKonamiCode(callback));

    // Use uppercase B and A
    pressSequence([
      "ArrowUp",
      "ArrowUp",
      "ArrowDown",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "ArrowLeft",
      "ArrowRight",
      "B",
      "A",
    ]);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  test("resets after successful activation", () => {
    const callback = vi.fn();
    renderHook(() => useKonamiCode(callback));

    // First activation
    pressSequence(KONAMI_SEQUENCE);
    expect(callback).toHaveBeenCalledTimes(1);

    // Second activation
    pressSequence(KONAMI_SEQUENCE);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  test("continues tracking after incorrect key in the middle", () => {
    const callback = vi.fn();
    renderHook(() => useKonamiCode(callback));

    // Start sequence, then wrong key, then full sequence
    pressSequence(["ArrowUp", "ArrowUp", "ArrowDown", "x"]);
    pressSequence(KONAMI_SEQUENCE);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  test("cleans up event listener on unmount", () => {
    const callback = vi.fn();
    const { unmount } = renderHook(() => useKonamiCode(callback));

    unmount();

    // Press sequence after unmount - should not trigger callback
    pressSequence(KONAMI_SEQUENCE);

    expect(callback).not.toHaveBeenCalled();
  });
});
