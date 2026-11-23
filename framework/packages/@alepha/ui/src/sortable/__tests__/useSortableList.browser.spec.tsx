import { DndContext } from "@dnd-kit/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { useSortableItem } from "../useSortableItem.ts";
import { useSortableList } from "../useSortableList.ts";

interface Saved {
  next: string[];
  previous: string[];
}

const Row = (props: {
  id: string;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  picked: boolean;
}) => {
  const item = useSortableItem(props.id);
  return (
    <li
      ref={item.ref}
      style={item.style}
      data-picked={props.picked || undefined}
    >
      <button
        type="button"
        data-testid={`row-${props.id}`}
        onKeyDown={props.onKeyDown}
      >
        {props.id}
      </button>
    </li>
  );
};

const List = (props: {
  initial: string[];
  saves: Saved[];
  server?: boolean;
}) => {
  const [ids, setIds] = useState(props.initial);
  const list = useSortableList({
    ids,
    labelOf: (id) => id,
    onReorder: (next, previous) => {
      props.saves.push({ next, previous });
      // The server reads the new order back.
      if (props.server) setIds(next);
    },
    announcements: {
      picked: (label) => `picked ${label}`,
      moved: (label, at, total) => `${label} ${at}/${total}`,
      dropped: (label) => `dropped ${label}`,
      cancelled: (label) => `cancelled ${label}`,
    },
  });
  return (
    <DndContext {...list.contextProps}>
      <p data-testid="live">{list.announcement}</p>
      <ul data-testid="order">
        {list.order.map((id) => (
          <Row
            key={id}
            id={id}
            onKeyDown={list.onKeyDown(id)}
            picked={list.picked === id}
          />
        ))}
      </ul>
    </DndContext>
  );
};

const order = () =>
  Array.from(screen.getByTestId("order").querySelectorAll("button")).map(
    (it) => it.textContent,
  );
const key = (id: string, k: string) =>
  fireEvent.keyDown(screen.getByTestId(`row-${id}`), { key: k });

/**
 * The shared sortable list (#Q4128): the keyboard move every list gets, the
 * order held until the app has it, and the announcements a screen reader
 * hears.
 */
describe("useSortableList", () => {
  it("moves an item from the keyboard and saves once, on the drop", () => {
    const saves: Saved[] = [];
    render(<List initial={["a", "b", "c"]} saves={saves} />);

    key("a", " ");
    expect(screen.getByTestId("live").textContent).toBe("picked a");
    key("a", "ArrowDown");
    key("a", "ArrowDown");
    expect(order()).toEqual(["b", "c", "a"]);
    expect(screen.getByTestId("live").textContent).toBe("a 3/3");
    // Drawn at each step, saved only on the drop.
    expect(saves).toHaveLength(0);

    key("a", "Enter");

    expect(saves).toEqual([
      { next: ["b", "c", "a"], previous: ["a", "b", "c"] },
    ]);
    expect(screen.getByTestId("live").textContent).toBe("dropped a");
    // Held until the app's order changes.
    expect(order()).toEqual(["b", "c", "a"]);
  });

  it("puts the item back on Escape, and saves nothing", () => {
    const saves: Saved[] = [];
    render(<List initial={["a", "b", "c"]} saves={saves} />);

    key("b", " ");
    key("b", "ArrowUp");
    expect(order()).toEqual(["b", "a", "c"]);
    key("b", "Escape");

    expect(order()).toEqual(["a", "b", "c"]);
    expect(saves).toHaveLength(0);
    expect(screen.getByTestId("live").textContent).toBe("cancelled b");
  });

  it("never moves past the ends, and a drop where it was saves nothing", () => {
    const saves: Saved[] = [];
    render(<List initial={["a", "b"]} saves={saves} />);

    key("a", " ");
    key("a", "ArrowUp");
    expect(order()).toEqual(["a", "b"]);
    key("a", " ");

    expect(saves).toHaveLength(0);
  });

  it("ignores the arrows until an item is picked up", () => {
    const saves: Saved[] = [];
    render(<List initial={["a", "b"]} saves={saves} />);

    key("a", "ArrowDown");

    expect(order()).toEqual(["a", "b"]);
  });

  it("hands back to the app's order once it reads back", () => {
    const saves: Saved[] = [];
    render(<List initial={["a", "b", "c"]} saves={saves} server />);

    key("c", " ");
    key("c", "ArrowUp");
    key("c", " ");

    expect(order()).toEqual(["a", "c", "b"]);
    expect(saves).toHaveLength(1);
  });
});
