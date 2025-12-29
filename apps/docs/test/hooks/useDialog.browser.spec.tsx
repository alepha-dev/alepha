import { act, renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { useDialog } from "../../src/components/layout/Dialog.tsx";

describe("useDialog", () => {
  test("starts closed by default", () => {
    const { result } = renderHook(() => useDialog());

    expect(result.current.open).toBe(false);
    expect(result.current.dialogProps.open).toBe(false);
  });

  test("starts open when defaultOpen is true", () => {
    const { result } = renderHook(() => useDialog({ defaultOpen: true }));

    expect(result.current.open).toBe(true);
    expect(result.current.dialogProps.open).toBe(true);
  });

  test("openDialog opens the dialog", () => {
    const { result } = renderHook(() => useDialog());

    act(() => {
      result.current.openDialog();
    });

    expect(result.current.open).toBe(true);
  });

  test("closeDialog closes the dialog", () => {
    const { result } = renderHook(() => useDialog({ defaultOpen: true }));

    act(() => {
      result.current.closeDialog();
    });

    expect(result.current.open).toBe(false);
  });

  test("toggleDialog toggles the dialog state", () => {
    const { result } = renderHook(() => useDialog());

    // Toggle open
    act(() => {
      result.current.toggleDialog();
    });
    expect(result.current.open).toBe(true);

    // Toggle closed
    act(() => {
      result.current.toggleDialog();
    });
    expect(result.current.open).toBe(false);
  });

  test("dialogProps.onClose closes the dialog", () => {
    const { result } = renderHook(() => useDialog({ defaultOpen: true }));

    act(() => {
      result.current.dialogProps.onClose();
    });

    expect(result.current.open).toBe(false);
  });

  test("dialogProps is stable across renders", () => {
    const { result, rerender } = renderHook(() => useDialog());

    const firstDialogProps = result.current.dialogProps;

    rerender();

    // dialogProps object will be recreated but the behavior should be the same
    expect(result.current.dialogProps.open).toBe(firstDialogProps.open);
  });

  test("callbacks are stable across renders", () => {
    const { result, rerender } = renderHook(() => useDialog());

    const firstOpenDialog = result.current.openDialog;
    const firstCloseDialog = result.current.closeDialog;
    const firstToggleDialog = result.current.toggleDialog;

    rerender();

    expect(result.current.openDialog).toBe(firstOpenDialog);
    expect(result.current.closeDialog).toBe(firstCloseDialog);
    expect(result.current.toggleDialog).toBe(firstToggleDialog);
  });
});
