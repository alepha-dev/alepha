import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { AlephaLoreParser } from "../src/api/services/parsers/AlephaLoreParser.ts";

describe("AlephaLoreParser", () => {
  const setup = () => {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    });
    return alepha.inject(AlephaLoreParser);
  };

  it("canParse returns true when header has shortId,title,priority", ({
    expect,
  }) => {
    const parser = setup();
    expect(
      parser.canParse(["shortId", "title", "priority", "difficulty"]),
    ).toBe(true);
    expect(parser.canParse(["Card Name", "List"])).toBe(false);
  });

  it("parses a typical row with shortId → writeMode=upsert", ({ expect }) => {
    const parser = setup();
    const header = [
      "shortId",
      "title",
      "status",
      "priority",
      "difficulty",
      "area",
      "kanbanColumn",
      "milestone",
      "createdBy",
      "acceptedBy",
      "completedBy",
      "createdAt",
      "acceptedAt",
      "completedAt",
      "objectives",
      "description",
    ];
    const result = parser.parseRow(
      header,
      [
        "7",
        "Build wall",
        "accepted",
        "high",
        "4",
        "North",
        "doing",
        "Milestone 1",
        "alice@example.com",
        "bob@example.com",
        "",
        "2026-05-01T10:00:00Z",
        "2026-05-02T10:00:00Z",
        "",
        `[{"title":"Stack stones","completed":true}]`,
        "Some <b>html</b>",
      ],
      1,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.row).toEqual({
      rowIndex: 1,
      writeMode: "upsert",
      shortId: "7",
      title: "Build wall",
      description: "Some <b>html</b>",
      area: "North",
      priority: "high",
      // The header this row is parsed against predates the `size` column, so
      // the parser fills the neutral middle rather than leaving it unset.
      size: 3,
      kanbanColumn: "doing",
      milestone: "Milestone 1",
      createdBy: "alice@example.com",
      acceptedBy: "bob@example.com",
      completedBy: "",
      createdAt: "2026-05-01T10:00:00Z",
      acceptedAt: "2026-05-02T10:00:00Z",
      completedAt: "",
      objectives: [{ title: "Stack stones", completed: true }],
    });
  });

  it("uses writeMode=create when shortId is empty", ({ expect }) => {
    const parser = setup();
    const result = parser.parseRow(
      ["shortId", "title", "priority", "difficulty"],
      ["", "Quest", "medium", "2"],
      1,
    );
    expect(result.ok && result.row.writeMode).toBe("create");
  });

  it("errors when title is missing", ({ expect }) => {
    const parser = setup();
    const result = parser.parseRow(
      ["shortId", "title", "priority", "difficulty"],
      ["1", "", "medium", "2"],
      3,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.row).toBe(3);
    expect(result.error.message).toMatch(/title/i);
  });

  it("accepts and ignores a difficulty header from a pre-erasure export", ({
    expect,
  }) => {
    const parser = setup();
    // The difficulty mechanic was erased, but a CSV exported before that
    // must still import — including a value the old 1-5 validation would
    // have rejected, since nothing reads the column anymore.
    const result = parser.parseRow(
      ["shortId", "title", "priority", "difficulty"],
      ["", "Quest", "medium", "9"],
      1,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.row).not.toHaveProperty("difficulty");
    expect(result.row.title).toBe("Quest");
  });

  it("reads the size ordinal from its own column", ({ expect }) => {
    const parser = setup();
    const result = parser.parseRow(
      ["shortId", "title", "priority", "size"],
      ["", "Quest", "medium", "5"],
      1,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.row.size).toBe(5);
  });

  it("falls back to 3 when size is absent, empty or off the scale", ({
    expect,
  }) => {
    const parser = setup();
    // Three ways the cell can fail to name a size, all landing on the
    // neutral middle rather than failing the row: a CSV taken before the
    // column existed, an empty cell, and a value outside 1-5.
    const cases: Array<[string[], string[]]> = [
      [
        ["title", "priority"],
        ["Quest", "medium"],
      ],
      [
        ["title", "priority", "size"],
        ["Quest", "medium", ""],
      ],
      [
        ["title", "priority", "size"],
        ["Quest", "medium", "9"],
      ],
    ];
    for (const [header, cells] of cases) {
      const result = parser.parseRow(header, cells, 1);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.row.size).toBe(3);
    }
  });

  it("drops the export's leading apostrophe back off every cell", ({
    expect,
  }) => {
    const parser = setup();
    const header = ["title", "priority", "area", "description"];
    const result = parser.parseRow(
      header,
      ['\'=HYPERLINK("x")', "medium", "'+North", "''tis a description"],
      1,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.row.title).toBe('=HYPERLINK("x")');
    expect(result.row.area).toBe("+North");
    // Doubled on export precisely so one strip leaves the original.
    expect(result.row.description).toBe("'tis a description");
  });

  it("errors when objectives JSON is malformed", ({ expect }) => {
    const parser = setup();
    const header = ["title", "priority", "difficulty", "objectives"];
    const result = parser.parseRow(header, ["Q", "medium", "1", "not-json"], 5);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.message).toMatch(/objectives/i);
  });
});
