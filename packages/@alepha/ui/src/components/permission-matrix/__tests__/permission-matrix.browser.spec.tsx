import { fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import type { PermissionMatrixGroup } from "../permission-matrix.tsx";
import { PermissionMatrix } from "../permission-matrix.tsx";

/**
 * What these pin is what the component is NOT allowed to know.
 *
 * Two applications render this table for two different models: Lore hides the
 * permissions of a capability that is off, Alepha Club has no capabilities at
 * all; Lore has an owner rank, and the component must not. Each case below is
 * one of those boundaries, because a component that learns one of them is a
 * component the other consumer has to pass `undefined` to forever.
 *
 * Cells are addressed by the permission NAME rather than by its label - the
 * `aria-label` the component sets - so these say nothing about copy, which is
 * the caller's.
 */
const CORE: PermissionMatrixGroup = {
  key: "project",
  label: "Project",
  permissions: [
    { name: "project:read", label: "Read", lock: "on" },
    { name: "project:update", label: "Update" },
    { name: "project:delete", label: "Delete", lock: "off" },
  ],
};

const APPS: PermissionMatrixGroup = {
  key: "app",
  label: "Apps",
  permissions: [{ name: "app:manage", label: "Manage apps" }],
};

const COLUMNS = [
  { key: "owner", label: "Owner", readOnly: true },
  { key: "member", label: "Member" },
];

const cellsFor = (container: HTMLElement, permission: string) =>
  [
    ...container.querySelectorAll(`[aria-label="${permission}"]`),
  ] as HTMLElement[];

const isChecked = (cell: HTMLElement) =>
  cell.getAttribute("data-checked") !== null ||
  cell.getAttribute("aria-checked") === "true";

const isDisabled = (cell: HTMLElement) =>
  cell.hasAttribute("disabled") || cell.getAttribute("data-disabled") !== null;

/**
 * Whether the cell wears a padlock: a locked crossing that reads unticked, and
 * so would otherwise invite a click that can never land.
 */
const isClosed = (cell: HTMLElement) =>
  cell.closest("[data-slot='permission-locked']") !== null;

describe("PermissionMatrix", () => {
  const mount = (
    groups: PermissionMatrixGroup[] = [CORE, APPS],
    initial: Record<string, string[]> = { member: ["project:update"] },
  ) => {
    const seen: Record<string, string[]>[] = [];

    const Harness = () => {
      const [value, setValue] = useState(initial);
      return (
        <PermissionMatrix
          header="Permission"
          empty="Nothing to show"
          groups={groups}
          columns={COLUMNS}
          value={value}
          onChange={(next) => {
            seen.push(next);
            setValue(next);
          }}
        />
      );
    };

    return { ...render(<Harness />), seen };
  };

  it("renders a read-only column all-on, including what no rank may be granted", () => {
    const { container } = mount();

    // The whole reason `readOnly` beats a row's own lock: an owner HAS
    // `project:delete`. It is the granting of it that is refused, and a
    // half-ticked owner column would say the opposite.
    for (const name of ["project:read", "project:update", "project:delete"]) {
      const [owner] = cellsFor(container, name);
      expect(isChecked(owner)).toBe(true);
      expect(isDisabled(owner)).toBe(true);
    }
  });

  it("pins a floor row on and a ceiling row off, on every editable column", () => {
    const { container } = mount();

    const [, floor] = cellsFor(container, "project:read");
    expect(isChecked(floor)).toBe(true);
    expect(isDisabled(floor)).toBe(true);

    const [, ceiling] = cellsFor(container, "project:delete");
    expect(isChecked(ceiling)).toBe(false);
    expect(isDisabled(ceiling)).toBe(true);
  });

  it("hands back the whole record on a tick, not a delta", () => {
    const { container, seen } = mount([CORE, APPS], {
      member: ["project:update"],
      reviewer: ["app:manage"],
    });

    const [, member] = cellsFor(container, "app:manage");
    fireEvent.click(member);

    // `reviewer` is untouched by this click and has to survive it: the caller
    // saves the record it is handed, and a partial one silently drops every
    // rank nobody clicked.
    expect(seen).toHaveLength(1);
    expect(seen[0].member).toEqual(["project:update", "app:manage"]);
    expect(seen[0].reviewer).toEqual(["app:manage"]);
  });

  it("unticks by removing the name rather than rewriting the list", () => {
    const { container, seen } = mount();

    const [, member] = cellsFor(container, "project:update");
    fireEvent.click(member);

    expect(seen[0].member).toEqual([]);
  });

  it("renders exactly the groups it is handed, and asks nothing about why", () => {
    // An application that hides a subject passes fewer groups. There is no
    // capability prop, and adding one is the failure mode this pins.
    const { container } = mount([CORE]);

    expect(cellsFor(container, "app:manage")).toHaveLength(0);
    expect(container.textContent).toContain("Project");
    expect(container.textContent).not.toContain("Apps");
  });

  it("shows the caller's empty copy when every group is filtered away", () => {
    const { container } = mount([]);

    expect(container.textContent).toContain("Nothing to show");
    expect(container.querySelector("table")).toBeNull();
  });

  it("carries no copy of its own", () => {
    const { container } = mount();

    // Every WORD on screen came in as a prop. If this ever fails it is because
    // a default label was added, and a French-only application would then
    // render one English word it cannot reach.
    //
    // Strip the caller's own copy and the permission names it supplied - the
    // component prints those under each label - and what is left has to hold
    // no letters at all. It does hold characters: the group sizes and each
    // column's coverage ratio. Those are counts of the caller's own rows,
    // spelled in digits and punctuation, so they are language-free in every
    // locale and are the reason this assertion checks for LETTERS rather than
    // for an empty string. A hardcoded "of" or "granted" would still fail.
    const text = container.textContent ?? "";
    for (const own of ["Permission", "Project", "Apps", "Owner", "Member"]) {
      expect(text).toContain(own);
    }

    // Narrowed rather than coerced: a label is a `ReactNode`, and `String()`
    // on one would quietly strip "[object Object]" the day a fixture passes a
    // node. Every fixture above passes a string, so the filter removes nothing
    // today and turns a future node into a FAILING assertion rather than a
    // silently weakened one.
    const callerCopy = [
      "Permission",
      ...[CORE, APPS].flatMap((group) => [
        group.label,
        ...group.permissions.flatMap((row) => [row.label, row.name]),
      ]),
      ...COLUMNS.map((column) => column.label),
    ].filter((it): it is string => typeof it === "string");

    let rest = text;
    for (const copy of callerCopy) rest = rest.split(copy).join("");

    expect(rest).not.toMatch(/\p{Letter}/u);
  });

  it("closes a cell that can never be ticked, and only that cell", () => {
    // A padlock is laid over the box exactly where a reader would otherwise be
    // invited to tick something that will never move. The owner column is the
    // control case in the same row: it is locked too, but it reads all-on, so
    // it stays an ordinary (disabled) box.
    const { container } = mount();

    const [owner, member] = cellsFor(container, "project:delete");
    expect(isClosed(owner)).toBe(false);
    expect(isChecked(owner)).toBe(true);
    expect(isClosed(member)).toBe(true);

    // Still a labelled checkbox underneath, not a picture: the padlock is a
    // rendering, and swapping the control out would take the cell off the
    // accessibility tree.
    expect(isDisabled(member)).toBe(true);
    expect(isChecked(member)).toBe(false);

    // The floor row is locked in the other direction - checked everywhere - so
    // nothing in it is closed.
    for (const cell of cellsFor(container, "project:read")) {
      expect(isClosed(cell)).toBe(false);
    }

    // And an ordinary unchecked cell stays open, because it CAN be ticked.
    const [, updatable] = cellsFor(container, "app:manage");
    expect(isClosed(updatable)).toBe(false);
    expect(isChecked(updatable)).toBe(false);
  });

  it("counts each column's coverage over the rows actually shown", () => {
    // The ratio is the component's own arithmetic, so it is worth pinning in
    // both directions: a read-only column reads all-on even across the ceiling
    // row, and a filtered-away group leaves the denominator with it.
    const { container } = mount();
    expect(container.textContent).toContain("4/4");
    expect(container.textContent).toContain("2/4");

    const { container: core } = mount([CORE]);
    expect(core.textContent).toContain("3/3");
    expect(core.textContent).toContain("2/3");
  });
});
