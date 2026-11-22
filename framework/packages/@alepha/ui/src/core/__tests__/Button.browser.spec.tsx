import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "../Button.tsx";

/**
 * `loading` is the kit's own addition to the button, and every submit in the
 * kit leans on it to refuse a double click. What it promises is DOM: busy,
 * disabled, a spinner in place of the label, and the label kept in the layout
 * so the button does not change width.
 */
describe("Button loading", () => {
  it("is busy, disabled and shows a spinner while loading", () => {
    render(<Button loading>Save</Button>);
    const button = screen.getByRole("button");

    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.hasAttribute("data-loading")).toBe(true);
    expect(button.querySelector("svg.animate-spin")).not.toBeNull();
  });

  it("keeps the label in the layout, painted out, so the width holds", () => {
    render(<Button loading>Save</Button>);
    const label = screen.getByText("Save");

    expect(label.className).toContain("text-transparent");
    expect(label.className).not.toContain("invisible");
  });

  it("keeps its accessible name while loading", () => {
    render(<Button loading>Save</Button>);

    // `visibility: hidden` would drop the label from the accessibility tree
    // and leave a nameless button for as long as the work runs.
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("does not run its click handler while loading", () => {
    let clicks = 0;
    render(
      <Button loading onClick={() => clicks++}>
        Save
      </Button>,
    );

    fireEvent.click(screen.getByRole("button"));
    expect(clicks).toBe(0);
  });

  it("carries none of it when not loading", () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole("button");

    expect(button.hasAttribute("aria-busy")).toBe(false);
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(button.hasAttribute("data-loading")).toBe(false);
    expect(button.querySelector("svg.animate-spin")).toBeNull();
    expect(screen.getByText("Save").className).not.toContain(
      "text-transparent",
    );
  });
});

/**
 * A page translator (Chrome's "Translate this page") replaces every text node
 * it translates with `<font>` elements. React still holds the original node,
 * so the next `insertBefore(newIcon, textNode)` throws `NotFoundError` and the
 * whole tree falls to the error boundary. A label beside a conditional icon is
 * exactly that shape: the label must be an element of its own.
 */
describe("Button under a page translator", () => {
  const translate = (root: HTMLElement) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    for (const node of nodes) {
      const font = document.createElement("font");
      font.textContent = `fr:${node.data}`;
      node.replaceWith(font);
    }
  };

  const IconSwap = (props: { busy: boolean }) => (
    <Button>
      {props.busy ? <i data-testid="busy" /> : <b data-testid="idle" />}
      Attach
    </Button>
  );

  it("swaps an icon beside a translated label without throwing", () => {
    const view = render(<IconSwap busy={false} />);
    translate(view.container);

    expect(() => view.rerender(<IconSwap busy />)).not.toThrow();
    expect(screen.getByTestId("busy")).toBeTruthy();
    expect(screen.queryByTestId("idle")).toBeNull();
  });

  it("mounts a conditional icon beside a translated label without throwing", () => {
    const Submit = (props: { busy: boolean }) => (
      <Button>
        {props.busy && <i data-testid="busy" />}
        Send
      </Button>
    );
    const view = render(<Submit busy={false} />);
    translate(view.container);

    expect(() => view.rerender(<Submit busy />)).not.toThrow();
    expect(screen.getByTestId("busy")).toBeTruthy();
  });

  it("leaves a lone label as the content itself", () => {
    render(<Button>Save</Button>);

    expect(screen.getByText("Save").getAttribute("data-slot")).toBeNull();
    expect(screen.getByText("Save").className).toContain("contents");
  });
});
