import { Alepha } from "alepha";
import { describe, it } from "vitest";
import { QuestCsvParser } from "../src/api/services/QuestCsvParser.ts";

describe("QuestCsvParser", () => {
  const setup = () => {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    });
    alepha.inject(QuestCsvParser);
    return alepha.inject(QuestCsvParser);
  };

  it("parses simple comma-separated rows", ({ expect }) => {
    const parser = setup();
    const rows = parser.parse(`a,b,c\n1,2,3\n4,5,6\n`);
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
      ["4", "5", "6"],
    ]);
  });

  it("handles quoted fields containing commas", ({ expect }) => {
    const parser = setup();
    const rows = parser.parse(`title,body\n"Hello, world","line one"\n`);
    expect(rows).toEqual([
      ["title", "body"],
      ["Hello, world", "line one"],
    ]);
  });

  it("handles doubled quotes inside quoted fields", ({ expect }) => {
    const parser = setup();
    const rows = parser.parse(`name\n"She said ""hi"""\n`);
    expect(rows[1]).toEqual([`She said "hi"`]);
  });

  it("preserves newlines inside quoted fields", ({ expect }) => {
    const parser = setup();
    const rows = parser.parse(`body\n"line one\nline two"\n`);
    expect(rows[1]).toEqual(["line one\nline two"]);
  });

  it("ignores a trailing newline", ({ expect }) => {
    const parser = setup();
    expect(parser.parse("a\n").length).toBe(1);
    expect(parser.parse("a").length).toBe(1);
  });

  it("trims a leading BOM if present", ({ expect }) => {
    const parser = setup();
    const rows = parser.parse("﻿a,b\n1,2\n");
    expect(rows[0]).toEqual(["a", "b"]);
  });
});
