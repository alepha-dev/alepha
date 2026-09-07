import { describe, expect, it } from "vitest";

import type { PermissionCatalogueGroup } from "./projectRankMatrix.ts";
import { ProjectRankMatrix } from "./projectRankMatrix.ts";

/**
 * The four filters and the two locks, which are the whole of what this page
 * adds to `@alepha/ui`'s matrix.
 *
 * They live here rather than in a browser spec because none of them is about
 * rendering: the component takes groups and draws them, and every decision
 * worth a regression test happens before it is handed anything.
 */
const CATALOGUE: PermissionCatalogueGroup[] = [
  {
    name: "project",
    label: "permission.group.project",
    permissions: [
      { name: "project:read", label: "permission.project.read" },
      { name: "project:update", label: "permission.project.update" },
      { name: "project:delete", label: "permission.project.delete" },
      { name: "project:create", label: "permission.project.create" },
    ],
  },
  {
    name: "quest",
    label: "permission.group.quest",
    permissions: [{ name: "quest:create", label: "permission.quest.create" }],
  },
  {
    name: "app",
    label: "permission.group.app",
    permissions: [{ name: "app:manage", label: "permission.app.manage" }],
  },
  {
    // The group whose ONLY permission is a ceiling one, which is the real
    // shape of `capability` in the registry: dropping the row has to drop
    // the header with it, or the page grows an empty section.
    name: "capability",
    label: "permission.group.capability",
    permissions: [
      { name: "capability:manage", label: "permission.capability.manage" },
    ],
  },
  {
    // The framework's own, as the registry really answers them: no group
    // label, no permission label, and nothing a project rank narrows.
    name: "api-key",
    permissions: [{ name: "api-key:create" }],
  },
];

// The page passes `tr`; here the key IS the label, so an assertion can say
// which key a row would render without depending on a catalogue.
const label = (key: string, fallback: string) => key || fallback;

const rowsFor = (input: { enabled?: string[]; held?: readonly string[] }) =>
  ProjectRankMatrix.rowsFor({
    catalogue: CATALOGUE,
    enabled: (input.enabled ?? ["work", "apps"]) as never,
    held: input.held ?? ["*"],
    label,
  });

const groupKeys = (input: Parameters<typeof rowsFor>[0]) =>
  rowsFor(input).map((it) => it.key);

const lockOf = (
  input: Parameters<typeof rowsFor>[0],
  permission: string,
): "on" | "off" | undefined =>
  rowsFor(input)
    .flatMap((group) => group.permissions)
    .find((row) => row.name === permission)?.lock;

describe("ProjectRankMatrix", () => {
  it("never offers a group the application did not label", () => {
    // The registry holds the framework's own permissions too, and they are
    // instance-scope: no project rank narrows `api-key:create`. Before this
    // filter the matrix rendered a section headed `API-KEY` with a checkbox
    // nobody could tick, which is what a missing label looks like on screen.
    expect(groupKeys({})).not.toContain("api-key");
  });

  it("never offers a permission that happens outside every project", () => {
    // Different from the ceiling: `project:create` is not withheld from a
    // rank, it is not a project-scoped act at all. A locked row would be
    // answering a question nobody asked here.
    const rows = rowsFor({}).flatMap((it) => it.permissions);
    expect(rows.map((it) => it.name)).not.toContain("project:create");
  });

  it("drops a group whose capability is off, and keeps the Core ones", () => {
    const keys = groupKeys({ enabled: ["knowledge"] });

    // Work and Apps are off, so their groups are gone entirely rather than
    // greyed: the answer to "why can nobody have this" is on another page.
    expect(keys).not.toContain("quest");
    expect(keys).not.toContain("app");
    // `project` belongs to no capability, so it survives a project with every
    // capability switched off - which is a legal state.
    expect(keys).toContain("project");
  });

  it("never offers a permission no rank can ever hold", () => {
    // The CEILING (feedback #P2124). `project:delete` and `capability:manage`
    // are ungrantable structurally, so their row was a permanently grey,
    // permanently unchecked box in every column - a choice that does not
    // exist, drawn once per rank.
    const rows = rowsFor({}).flatMap((it) => it.permissions);

    expect(rows.map((it) => it.name)).not.toContain("project:delete");
    expect(rows.map((it) => it.name)).not.toContain("capability:manage");
  });

  it("drops the group the ceiling empties, header and all", () => {
    // `capability` holds nothing else, so removing its one row must remove
    // the section rather than leave a heading over nothing.
    expect(groupKeys({})).not.toContain("capability");
    // The neighbouring group loses one row and survives.
    expect(groupKeys({})).toContain("project");
  });

  it("pins the floor on", () => {
    // Unclickable like the ceiling and kept on purpose: it says something
    // true and useful, which is that every rank can open the project.
    expect(lockOf({}, "project:read")).toBe("on");
  });

  it("locks a permission the editor does not hold", () => {
    // The never-widen invariant, surfaced. An Admin editing a rank cannot
    // hand out something they were never given, and the module refuses it
    // anyway - this is what stops the checkbox from moving first.
    const admin = ["project:read", "project:update", "quest:create"];

    expect(lockOf({ held: admin }, "quest:create")).toBeUndefined();
    expect(lockOf({ held: admin }, "app:manage")).toBe("off");
  });

  it("locks nothing for an owner's wildcard", () => {
    // `["*"]` rather than an enumerated set, which is what an owner's rank
    // actually stores - and the same wildcard reading `RankService.grants`
    // applies, so the editor and the write path agree.
    expect(lockOf({ held: ["*"] }, "app:manage")).toBeUndefined();
  });

  it("keeps the editor-does-not-hold lock, which is a different signal", () => {
    // ⚠️ The reason the ceiling filter is a filter and this one is not.
    // `lockOf` answers `"off"` here too, but hiding these rows would give the
    // matrix a different SHAPE for every reader: an Admin comparing notes
    // with the Owner would see fewer rows, with nothing saying why. That lock
    // is informative; the ceiling's was not.
    const admin = ["project:read", "project:update", "quest:create"];
    const names = rowsFor({ held: admin })
      .flatMap((it) => it.permissions)
      .map((it) => it.name);

    expect(names).toContain("app:manage");
    expect(lockOf({ held: admin }, "app:manage")).toBe("off");
  });

  it("reads a group prefix wildcard the way the module does", () => {
    expect(lockOf({ held: ["project:*"] }, "project:update")).toBeUndefined();
    expect(lockOf({ held: ["project:*"] }, "quest:create")).toBe("off");
  });

  it("carries the label KEYS through, and never any copy", () => {
    const project = rowsFor({}).find((it) => it.key === "project");

    expect(project?.label).toBe("permission.group.project");
    expect(project?.permissions[0].label).toBe("permission.project.read");
  });
});
