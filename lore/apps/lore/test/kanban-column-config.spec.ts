import { describe, expect, it } from "vitest";

import type { Project } from "../src/api/entities/projects.ts";
import { KanbanColumnConfig } from "../src/api/services/KanbanColumnConfig.ts";

const LABELS = { new: "New", completed: "Completed" };

const project = (
  kanbanColumns: string[],
  kanbanColumnConfig?: Project["kanbanColumnConfig"],
): Pick<Project, "kanbanColumns" | "kanbanColumnConfig"> => ({
  kanbanColumns,
  kanbanColumnConfig,
});

describe("KanbanColumnConfig", () => {
  const config = new KanbanColumnConfig();

  /**
   * The compatibility claim that let this ship as a bare additive column:
   * a project that has configured nothing must render precisely the board
   * it rendered before #1227.
   */
  describe("a project with no config", () => {
    it("resolves to the frame the board has always had", () => {
      const columns = config.resolve(project(["In Progress"]), LABELS);
      expect(columns.map((c) => [c.name, c.status, c.synthesized])).toEqual([
        ["New", "new", true],
        ["In Progress", "accepted", false],
        ["Completed", "completed", true],
      ]);
    });

    it("treats every configured column as accepted", () => {
      const columns = config.resolve(project(["Doing", "Review"]), LABELS);
      expect(columns.filter((c) => c.status === "accepted")).toHaveLength(2);
      expect(columns).toHaveLength(4);
    });
  });

  /**
   * The point of the quest: the frame stops being hardcoded.
   */
  describe("columns carrying a status", () => {
    it("lets a project have two done-ish columns", () => {
      const columns = config.resolve(
        project(["Doing", "Shipped", "Archived"], {
          Shipped: { status: "completed" },
          Archived: { status: "completed" },
        }),
        LABELS,
      );
      // Both done columns, and NO synthesized Completed on the end.
      expect(columns.filter((c) => c.status === "completed")).toHaveLength(2);
      expect(columns.some((c) => c.synthesized && c.name === "Completed")).toBe(
        false,
      );
    });

    it("lets a project replace the synthesized New lane", () => {
      const columns = config.resolve(
        project(["Backlog", "Doing"], { Backlog: { status: "new" } }),
        LABELS,
      );
      expect(columns[0].name).toBe("Backlog");
      expect(columns[0].synthesized).toBe(false);
      expect(columns.some((c) => c.synthesized && c.name === "New")).toBe(
        false,
      );
    });

    it("still synthesizes the end a project has not named", () => {
      const columns = config.resolve(
        project(["Backlog", "Doing"], { Backlog: { status: "new" } }),
        LABELS,
      );
      const last = columns[columns.length - 1];
      expect(last.name).toBe("Completed");
      expect(last.synthesized).toBe(true);
    });

    it("keeps the configured order", () => {
      const columns = config.resolve(
        project(["Doing", "Review", "Shipped"], {
          Shipped: { status: "completed" },
        }),
        LABELS,
      );
      expect(columns.map((c) => c.name)).toEqual([
        "New",
        "Doing",
        "Review",
        "Shipped",
      ]);
    });
  });

  describe("WIP limits", () => {
    it("carries a limit through to the resolved column", () => {
      const columns = config.resolve(
        project(["Doing"], { Doing: { wipLimit: 3 } }),
        LABELS,
      );
      expect(columns.find((c) => c.name === "Doing")?.wipLimit).toBe(3);
    });

    it("leaves synthesized columns without one", () => {
      const columns = config.resolve(
        project(["Doing"], { Doing: { wipLimit: 3 } }),
        LABELS,
      );
      expect(
        columns.filter((c) => c.synthesized).every((c) => !c.wipLimit),
      ).toBe(true);
    });
  });

  /**
   * The config is keyed by name, so it can outlive the column it describes.
   */
  describe("a stale entry", () => {
    it("is inert rather than producing a column", () => {
      const columns = config.resolve(
        project(["Doing"], { Deleted: { status: "completed", wipLimit: 9 } }),
        LABELS,
      );
      expect(columns.map((c) => c.name)).toEqual(["New", "Doing", "Completed"]);
    });
  });
});
