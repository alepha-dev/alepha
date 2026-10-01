import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../Command.tsx";

/**
 * The palette on Base UI's `Autocomplete`, driven through its DOM: what the
 * query leaves, in which order, which row is highlighted, and what Enter runs.
 * The scorer itself is pinned in `rankCommandItems.spec.ts`.
 */
describe("Command", () => {
  interface PaletteGroup {
    [key: string]: unknown;
    key: string;
    label: string;
    items: string[];
  }

  const groups: PaletteGroup[] = [
    { key: "blocks", label: "Blocks", items: ["Tree", "Table", "Tabs"] },
    { key: "pages", label: "Pages", items: ["Audit log", "Users"] },
  ];

  const Palette = (props: {
    onRun?: (item: string) => void;
    mode?: "list" | "none";
    groups?: PaletteGroup[];
  }) => (
    <Command<string> items={props.groups ?? groups} mode={props.mode}>
      <CommandInput placeholder="Search" />
      <CommandEmpty>Nothing matches.</CommandEmpty>
      <CommandList>
        {(group: PaletteGroup) => (
          <CommandGroup
            key={group.key}
            items={group.items}
            heading={group.label}
          >
            {(item: string) => (
              <CommandItem
                key={item}
                value={item}
                onClick={() => props.onRun?.(item)}
              >
                {item}
              </CommandItem>
            )}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );

  const rows = () =>
    [...document.querySelectorAll('[data-slot="command-item"]')].map(
      (row) => row.textContent,
    );
  const highlighted = () =>
    document.querySelector('[data-slot="command-item"][data-highlighted]')
      ?.textContent;
  const input = () => screen.getByPlaceholderText("Search");

  it("lists every row in the given order, the first one highlighted", async () => {
    render(<Palette />);

    await waitFor(() =>
      expect(rows()).toEqual(["Tree", "Table", "Tabs", "Audit log", "Users"]),
    );
    await waitFor(() => expect(highlighted()).toBe("Tree"));
    expect(screen.getByText("Blocks")).toBeTruthy();
    expect(screen.getByText("Pages")).toBeTruthy();
  });

  it("filters and ranks as the query changes, dropping empty groups", async () => {
    render(<Palette />);

    fireEvent.change(input(), { target: { value: "tab" } });

    // "Tree" has no "tab" in it; "Table" and "Tabs" tie and keep their order.
    await waitFor(() => expect(rows()).toEqual(["Table", "Tabs"]));
    await waitFor(() => expect(highlighted()).toBe("Table"));
    expect(screen.queryByText("Pages")).toBeNull();
  });

  /**
   * ⚠️ Ranked, not merely filtered. Base UI's own filter keeps the list order,
   * which would highlight "Reuse settings" (first group, "use" inside a word)
   * over "Users" (second group, "use" at the start). cmdk ranked, and
   * apps/ui's palette relies on it: the best match is what Enter runs.
   */
  it("puts the best match's group first, so Enter runs the best match", async () => {
    const ran: string[] = [];
    render(
      <Palette
        onRun={(item) => ran.push(item)}
        groups={[
          { key: "a", label: "Settings", items: ["Reuse settings"] },
          { key: "b", label: "Pages", items: ["Users"] },
        ]}
      />,
    );

    fireEvent.change(input(), { target: { value: "use" } });
    await waitFor(() => expect(rows()).toEqual(["Users", "Reuse settings"]));
    await waitFor(() => expect(highlighted()).toBe("Users"));

    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(ran).toEqual(["Users"]));
  });

  it("moves the highlight with the arrow keys", async () => {
    render(<Palette />);
    await waitFor(() => expect(highlighted()).toBe("Tree"));

    fireEvent.keyDown(input(), { key: "ArrowDown" });
    await waitFor(() => expect(highlighted()).toBe("Table"));
  });

  it("shows the empty state when nothing matches, and hides it otherwise", async () => {
    render(<Palette />);
    const empty = () => document.querySelector('[data-slot="command-empty"]');

    await waitFor(() => expect(rows().length).toBe(5));
    expect(empty()?.textContent).toBe("");

    fireEvent.change(input(), { target: { value: "zzz" } });
    await waitFor(() => expect(empty()?.textContent).toBe("Nothing matches."));
    expect(rows()).toEqual([]);
  });

  it("shows items as given in mode none, whatever is typed", async () => {
    render(<Palette mode="none" />);

    fireEvent.change(input(), { target: { value: "zzz" } });

    await waitFor(() => expect(input()).toHaveProperty("value", "zzz"));
    expect(rows()).toEqual(["Tree", "Table", "Tabs", "Audit log", "Users"]);
  });
});
