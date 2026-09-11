import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { QuestCsvFormatter } from "../src/api/services/QuestCsvFormatter.ts";

/**
 * Read a CSV document back into cells.
 *
 * ⚠️ **Test-only, and it used to be `QuestCsvParser`.** That service went
 * with quest import in epic #E48, and it was the only reader in the tree.
 * What these cases assert is CELL values - `He said "hi"`, `'+North`, the
 * doubled leading apostrophe - which only exist after unquoting, so the spec
 * needs a reader even though production no longer does. Asserting the raw
 * bytes instead would pin the quoting style rather than the contract.
 */
const readCsv = (text: string): string[][] => {
  const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < stripped.length; i += 1) {
    const char = stripped[i];
    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (stripped[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\r") {
      // Swallowed: a CRLF document ends its rows on the \n below.
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
};

describe("QuestCsvFormatter", () => {
  const setup = () => {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    });
    return { formatter: alepha.inject(QuestCsvFormatter) };
  };

  it("produces a header followed by data rows", ({ expect }) => {
    const { formatter } = setup();
    const text = formatter.format([
      {
        shortId: 1,
        title: "Build the wall",
        status: "todo",
        priority: "medium",
        size: 3,
        area: "North",
        kanbanColumn: "",
        release: "",
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
    const rows = readCsv(text);
    expect(rows[0]).toEqual([
      "shortId",
      "title",
      "status",
      "priority",
      "size",
      "area",
      "kanbanColumn",
      "release",
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
    const { formatter } = setup();
    const text = formatter.format([
      {
        shortId: 2,
        title: 'He said "hi"',
        status: "completed",
        priority: "low",
        size: 4,
        area: "Inn",
        kanbanColumn: "",
        release: "",
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
    const rows = readCsv(text);
    expect(rows[1][1]).toBe('He said "hi"');
    expect(rows[1][15]).toBe("line one\nline two");
  });

  it("neutralises cells a spreadsheet would evaluate", ({ expect }) => {
    const { formatter } = setup();
    const text = formatter.format([
      {
        shortId: 4,
        title: '=HYPERLINK("https://evil.example","click")',
        status: "todo",
        priority: "medium",
        size: 3,
        // Each of the other openings Excel and Sheets treat as a formula.
        area: "+North",
        kanbanColumn: "-Todo",
        release: "@here",
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
    const rows = readCsv(text);
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
    const { formatter } = setup();
    const text = formatter.format([
      {
        shortId: 5,
        title: "'tis the season",
        status: "todo",
        priority: "medium",
        size: 3,
        area: "",
        kanbanColumn: "",
        release: "",
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
    const rows = readCsv(text);
    expect(rows[1][1]).toBe("''tis the season");
  });

  it("serializes objectives as JSON", ({ expect }) => {
    const { formatter } = setup();
    const text = formatter.format([
      {
        shortId: 3,
        title: "Quest",
        status: "todo",
        priority: "medium",
        size: 3,
        area: "",
        kanbanColumn: "",
        release: "",
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
    const rows = readCsv(text);
    expect(JSON.parse(rows[1][14])).toEqual([
      { title: "Step 1", completed: true },
      { title: "Step 2", completed: false },
    ]);
  });
});
