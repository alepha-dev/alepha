import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SidebarProvider } from "../Sidebar.tsx";

/**
 * `SidebarProvider` toggles on Cmd/Ctrl+B from a window listener. Another
 * handler that already took the key (an editor binding it to bold) calls
 * `preventDefault()`, and the sidebar must leave it alone.
 */
describe("SidebarProvider keyboard shortcut", () => {
  it("toggles the sidebar on Ctrl+B", () => {
    const changes: boolean[] = [];
    render(<SidebarProvider onOpenChange={(open) => changes.push(open)} />);

    fireEvent.keyDown(document.body, { key: "b", ctrlKey: true });

    expect(changes).toEqual([false]);
  });

  it("leaves a Ctrl+B another handler already took", () => {
    const changes: boolean[] = [];
    const takeBold = (event: KeyboardEvent) => event.preventDefault();
    window.addEventListener("keydown", takeBold, true);
    try {
      render(<SidebarProvider onOpenChange={(open) => changes.push(open)} />);

      fireEvent.keyDown(document.body, { key: "b", ctrlKey: true });

      expect(changes).toEqual([]);
    } finally {
      window.removeEventListener("keydown", takeBold, true);
    }
  });
});
