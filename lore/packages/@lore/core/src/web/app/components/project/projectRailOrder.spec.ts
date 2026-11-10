import { describe, it } from "vitest";

import {
  PROJECT_MONOGRAM_COLORS,
  projectInitials,
  projectMonogramColor,
} from "../shared/projectMonogram.ts";
import { projectRailOrder } from "./projectRailOrder.ts";

const p = (id: number, updatedAt: string, archivedAt?: string) => ({
  id,
  updatedAt,
  archivedAt,
});

describe("projectInitials", () => {
  it("takes the first letter of the first two words", ({ expect }) => {
    expect(projectInitials("my-project")).toBe("MP");
    expect(projectInitials("tuto_verify")).toBe("TV");
    expect(projectInitials("Lore Docs Site")).toBe("LD");
    expect(projectInitials("s3-reader")).toBe("SR");
  });

  it("takes the first two letters of a single word", ({ expect }) => {
    expect(projectInitials("hello")).toBe("HE");
    expect(projectInitials("Club")).toBe("CL");
  });

  it("splits camelCase and drops symbols", ({ expect }) => {
    expect(projectInitials("myProject")).toBe("MP");
    expect(projectInitials("(alpha) [beta]")).toBe("AB");
    expect(projectInitials("✨")).toBe("?");
    expect(projectInitials("x")).toBe("X");
  });

  it("colours by seed, stably", ({ expect }) => {
    expect(projectMonogramColor("club")).toBe(projectMonogramColor("club"));
    expect(PROJECT_MONOGRAM_COLORS).toContain(projectMonogramColor("club"));
  });
});

describe("projectRailOrder", () => {
  const projects = [
    p(1, "2026-01-05"),
    p(2, "2026-01-04"),
    p(3, "2026-01-03"),
    p(4, "2026-01-02", "2026-01-10"),
    p(5, "2026-01-01"),
  ];
  const ids = (list: { id: number }[]) => list.map((it) => it.id);

  it("orders by updatedAt before anything was opened", ({ expect }) => {
    expect(ids(projectRailOrder(projects, [], 1, 10))).toEqual([1, 2, 3, 5]);
  });

  it("puts the opened ones first, in opened order", ({ expect }) => {
    expect(ids(projectRailOrder(projects, [5, 2], 2, 10))).toEqual([
      5, 2, 1, 3,
    ]);
  });

  it("caps the list, keeping the current project", ({ expect }) => {
    expect(ids(projectRailOrder(projects, [1, 2], 5, 2))).toEqual([1, 5]);
  });

  it("keeps the archived project being looked at", ({ expect }) => {
    expect(ids(projectRailOrder(projects, [4], 4, 10))).toEqual([
      4, 1, 2, 3, 5,
    ]);
  });

  it("ignores opened ids the viewer cannot see", ({ expect }) => {
    expect(ids(projectRailOrder(projects, [99, 3], 3, 10))).toEqual([
      3, 1, 2, 5,
    ]);
  });
});
