import { describe, it } from "vitest";

import { DotenvParser } from "./DotenvParser.ts";

describe("DotenvParser", () => {
  it("reads plain, exported and commented lines", ({ expect }) => {
    const result = DotenvParser.parse(
      [
        "# a comment",
        "",
        "PLAIN=value",
        "export EXPORTED=yes",
        "WITH_COMMENT=kept # dropped",
        "EMPTY=",
      ].join("\n"),
    );

    expect(result.entries).toEqual([
      { key: "PLAIN", value: "value", line: 3 },
      { key: "EXPORTED", value: "yes", line: 4 },
      { key: "WITH_COMMENT", value: "kept", line: 5 },
      { key: "EMPTY", value: "", line: 6 },
    ]);
    expect(result.errors).toEqual([]);
  });

  it("takes single quotes literally and unescapes double quotes", ({
    expect,
  }) => {
    const result = DotenvParser.parse(
      [
        "SINGLE='a # not a comment \\n'",
        'DOUBLE="line one\\nline \\"two\\""',
      ].join("\n"),
    );

    expect(result.entries.map((entry) => entry.value)).toEqual([
      "a # not a comment \\n",
      'line one\nline "two"',
    ]);
  });

  it("reads a double-quoted value across lines", ({ expect }) => {
    const result = DotenvParser.parse(
      ['KEY="-----BEGIN', "abc", '-----END"', "NEXT=1"].join("\n"),
    );

    expect(result.entries).toEqual([
      { key: "KEY", value: "-----BEGIN\nabc\n-----END", line: 1 },
      { key: "NEXT", value: "1", line: 4 },
    ]);
  });

  it("keeps the last value of a repeated key, and says it was repeated", ({
    expect,
  }) => {
    const result = DotenvParser.parse("KEY=first\nKEY=second");

    expect(result.entries).toEqual([{ key: "KEY", value: "second", line: 2 }]);
    expect(result.duplicates).toEqual(["KEY"]);
  });

  it("reports a line it cannot read, and an unterminated quote", ({
    expect,
  }) => {
    const result = DotenvParser.parse(
      ["not a line", 'OPEN="never closed', "FINE=1"].join("\r\n"),
    );

    expect(result.errors).toEqual([
      { line: 1, text: "not a line", reason: "syntax" },
      { line: 2, text: 'OPEN="never closed', reason: "unterminated" },
    ]);
  });
});
