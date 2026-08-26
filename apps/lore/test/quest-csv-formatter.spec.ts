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
        size: 3,
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
      "size",
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
    expect(rows[1][4]).toBe("3");
    expect(rows[1][14]).toBe("[]");
  });

  it("escapes embedded quotes and preserves newlines", ({ expect }) => {
    const { formatter, parser } = setup();
    const text = formatter.format([
      {
        shortId: 2,
        title: 'He said "hi"',
        status: "completed",
        priority: "low",
        size: 4,
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
    expect(rows[1][15]).toBe("line one\nline two");
  });

  it("neutralises cells a spreadsheet would evaluate", ({ expect }) => {
    const { formatter, parser } = setup();
    const text = formatter.format([
      {
        shortId: 4,
        title: '=HYPERLINK("https://evil.example","click")',
        status: "new",
        priority: "medium",
        size: 3,
        // Each of the other openings Excel and Sheets treat as a formula.
        area: "+North",
        kanbanColumn: "-Todo",
        milestone: "@here",
        createdBy: "\tleading-tab",
        acceptedBy: "",
        completedBy: "",
        createdAt: "",
        acceptedAt: "",
        completedAt: "",
        objectives: [],
        description: "Harmless",
      },
    ]);
    const rows = parser.parse(text);
    expect(rows[1][1]).toBe('\'=HYPERLINK("https://evil.example","click")');
    expect(rows[1][5]).toBe("'+North");
    expect(rows[1][6]).toBe("'-Todo");
    expect(rows[1][7]).toBe("'@here");
    expect(rows[1][8]).toBe("'\tleading-tab");
    // Untouched: nothing to defuse, and the header is never rewritten.
    expect(rows[1][15]).toBe("Harmless");
    expect(rows[0][1]).toBe("title");
  });

  it("doubles a leading apostrophe so the import-side strip is lossless", ({
    expect,
  }) => {
    const { formatter, parser } = setup();
    const text = formatter.format([
      {
        shortId: 5,
        title: "'tis the season",
        status: "new",
        priority: "medium",
        size: 3,
        area: "",
        kanbanColumn: "",
        milestone: "",
        createdBy: "",
        acceptedBy: "",
        completedBy: "",
        createdAt: "",
        acceptedAt: "",
        completedAt: "",
        objectives: [],
        description: "",
      },
    ]);
    const rows = parser.parse(text);
    expect(rows[1][1]).toBe("''tis the season");
  });

  it("serializes objectives as JSON", ({ expect }) => {
    const { formatter, parser } = setup();
    const text = formatter.format([
      {
        shortId: 3,
        title: "Quest",
        status: "new",
        priority: "medium",
        size: 3,
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
    expect(JSON.parse(rows[1][14])).toEqual([
      { title: "Step 1", completed: true },
      { title: "Step 2", completed: false },
    ]);
  });
});
