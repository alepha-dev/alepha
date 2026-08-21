import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { TrelloParser } from "../src/api/services/parsers/TrelloParser.ts";

describe("TrelloParser", () => {
  const setup = () => {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    });
    return alepha.inject(TrelloParser);
  };

  it("recognizes header with Card Name", ({ expect }) => {
    const parser = setup();
    expect(parser.canParse(["Card Name", "List", "Members"])).toBe(true);
    expect(parser.canParse(["shortId", "title"])).toBe(false);
  });

  it("maps Card Name → title, Card Description → description, List → area", ({
    expect,
  }) => {
    const parser = setup();
    const header = ["Card Name", "Card Description", "List", "Members"];
    const result = parser.parseRow(
      header,
      ["Refactor login", "Step 1...\nStep 2...", "Doing", "alice,bob"],
      1,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.row.title).toBe("Refactor login");
    expect(result.row.description).toBe("Step 1...\nStep 2...");
    expect(result.row.area).toBe("Doing");
    expect(result.row.acceptedBy).toBe("alice");
    expect(result.row.writeMode).toBe("create");
    expect(result.row.shortId).toBe("");
    expect(result.row.priority).toBe("medium");
  });

  it("errors when Card Name is empty", ({ expect }) => {
    const parser = setup();
    const result = parser.parseRow(["Card Name", "List"], ["", "Backlog"], 4);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.row).toBe(4);
    expect(result.error.message).toMatch(/card name/i);
  });
});
