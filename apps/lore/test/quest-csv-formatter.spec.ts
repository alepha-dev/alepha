import { Alepha } from "alepha";
import { describe, it } from "vitest";
import { QuestCsvFormatter } from "../src/api/services/QuestCsvFormatter.ts";
import { QuestCsvParser } from "../src/api/services/QuestCsvParser.ts";

describe("QuestCsvFormatter", () => {
  const setup = () => {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    });
    return {
      formatter: alepha.inject(QuestCsvFormatter),
      parser: alepha.inject(QuestCsvParser),
    };
  };

  it("produces a header followed by data rows", ({ expect }) => {
    const { formatter, parser } = setup();
    const text = formatter.format([
      {
        shortId: 1,
        title: "Build the wall",
        status: "new",
        priority: "medium",
        area: "North",
        kanbanColumn: "",
        milestone: "",
        createdBy: "alice@example.com",
        acceptedBy: "",
        completedBy: "",
        createdAt: "2026-05-01T10:00:00.000Z",
        acceptedAt: "",
        completedAt: "",
        objectives: [],
        description: "",
      },
    ]);
    const rows = parser.parse(text);
    expect(rows[0]).toEqual([
      "shortId",
      "title",
      "status",
      "priority",
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
    ]);
    expect(rows[1][0]).toBe("1");
    expect(rows[1][1]).toBe("Build the wall");
    expect(rows[1][13]).toBe("[]");
  });

  it("escapes embedded quotes and preserves newlines", ({ expect }) => {
    const { formatter, parser } = setup();
    const text = formatter.format([
      {
        shortId: 2,
        title: 'He said "hi"',
        status: "completed",
        priority: "low",
        area: "Inn",
        kanbanColumn: "",
        milestone: "",
        createdBy: "",
        acceptedBy: "",
        completedBy: "",
        createdAt: "",
        acceptedAt: "",
        completedAt: "",
        objectives: [],
        description: "line one\nline two",
      },
    ]);
    const rows = parser.parse(text);
    expect(rows[1][1]).toBe('He said "hi"');
    expect(rows[1][14]).toBe("line one\nline two");
  });

  it("serializes objectives as JSON", ({ expect }) => {
    const { formatter, parser } = setup();
    const text = formatter.format([
      {
        shortId: 3,
        title: "Quest",
        status: "new",
        priority: "medium",
        area: "",
        kanbanColumn: "",
        milestone: "",
        createdBy: "",
        acceptedBy: "",
        completedBy: "",
        createdAt: "",
        acceptedAt: "",
        completedAt: "",
        objectives: [
          { title: "Step 1", completed: true },
          { title: "Step 2", completed: false },
        ],
        description: "",
      },
    ]);
    const rows = parser.parse(text);
    expect(JSON.parse(rows[1][13])).toEqual([
      { title: "Step 1", completed: true },
      { title: "Step 2", completed: false },
    ]);
  });
});
