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
      difficulty: 4,
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

  it("errors when objectives JSON is malformed", ({ expect }) => {
    const parser = setup();
    const header = ["title", "priority", "difficulty", "objectives"];
    const result = parser.parseRow(header, ["Q", "medium", "1", "not-json"], 5);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.message).toMatch(/objectives/i);
  });
});
