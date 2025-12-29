import { act, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import Dialog, {
  DIALOG_CLOSE_DURATION,
} from "../../src/components/layout/Dialog.tsx";

describe("Dialog", () => {
  test("renders children when open", () => {
    render(
      <Dialog open={true} onClose={() => {}}>
        <div data-testid="content">Dialog Content</div>
      </Dialog>,
    );

    expect(screen.getByTestId("content")).toBeDefined();
  });

  test("does not render when closed", () => {
    render(
      <Dialog open={false} onClose={() => {}}>
        <div data-testid="content">Dialog Content</div>
      </Dialog>,
    );

    expect(screen.queryByTestId("content")).toBeNull();
  });

  test("calls onClose when Escape is pressed", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();

    render(
      <Dialog open={true} onClose={onClose}>
        <div>Content</div>
      </Dialog>,
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    // Wait for animation duration
    act(() => {
      vi.advanceTimersByTime(DIALOG_CLOSE_DURATION);
    });

    expect(onClose).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  test("does not call onClose on Escape when closeOnEscape is false", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();

    render(
      <Dialog open={true} onClose={onClose} closeOnEscape={false}>
        <div>Content</div>
      </Dialog>,
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      vi.advanceTimersByTime(DIALOG_CLOSE_DURATION);
    });

    expect(onClose).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  test("calls onClose when overlay is clicked", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();

    const { container } = render(
      <Dialog open={true} onClose={onClose}>
        <div data-testid="content">Content</div>
      </Dialog>,
    );

    // Click the overlay (first child of container)
    const overlay = container.firstChild as HTMLElement;
    act(() => {
      overlay.click();
    });

    act(() => {
      vi.advanceTimersByTime(DIALOG_CLOSE_DURATION);
    });

    expect(onClose).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  test("does not call onClose on overlay click when closeOnOverlayClick is false", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();

    const { container } = render(
      <Dialog open={true} onClose={onClose} closeOnOverlayClick={false}>
        <div>Content</div>
      </Dialog>,
    );

    const overlay = container.firstChild as HTMLElement;
    act(() => {
      overlay.click();
      vi.advanceTimersByTime(DIALOG_CLOSE_DURATION);
    });

    expect(onClose).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  test("does not close when clicking dialog content", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();

    render(
      <Dialog open={true} onClose={onClose}>
        <div data-testid="content">Content</div>
      </Dialog>,
    );

    act(() => {
      screen.getByTestId("content").click();
      vi.advanceTimersByTime(DIALOG_CLOSE_DURATION);
    });

    expect(onClose).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  test("applies custom className", () => {
    const { container } = render(
      <Dialog open={true} onClose={() => {}} className="custom-class">
        <div>Content</div>
      </Dialog>,
    );

    const dialogContainer = container.querySelector(".custom-class");
    expect(dialogContainer).not.toBeNull();
  });

  test("applies custom overlay padding", () => {
    const { container } = render(
      <Dialog open={true} onClose={() => {}} overlayPadding="100px 50px">
        <div>Content</div>
      </Dialog>,
    );

    const overlay = container.firstChild as HTMLElement;
    expect(overlay.style.padding).toBe("100px 50px");
  });

  test("cleans up event listener on unmount", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();

    const { unmount } = render(
      <Dialog open={true} onClose={onClose}>
        <div>Content</div>
      </Dialog>,
    );

    unmount();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      vi.advanceTimersByTime(DIALOG_CLOSE_DURATION);
    });

    expect(onClose).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
