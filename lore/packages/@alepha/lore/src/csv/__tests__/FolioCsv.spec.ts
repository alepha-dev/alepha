import { describe, it } from "vitest";

import { FolioCsv } from "../FolioCsv.ts";

describe("FolioCsv", () => {
  const csv = new FolioCsv();

  it("parses quoted fields, embedded newlines and doubled quotes", ({
    expect,
  }) => {
    const text =
      'Name,Note\r\n"Smith, J","said ""hi""\nthen left"\r\nplain,\r\n';
    expect(csv.parse(text).rows).toEqual([
      ["Name", "Note"],
      ["Smith, J", 'said "hi"\nthen left'],
      ["plain", ""],
    ]);
  });

  it("detects a semicolon or tab separator and drops a BOM", ({ expect }) => {
    expect(csv.parse("﻿a;b\n1;2").rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(csv.parse("a\tb\n1\t2").separator).toBe("\t");
    expect(csv.parse('"x;y",z\n1,2').separator).toBe(",");
  });

  it("writes CRLF with a BOM, quoting only what must be", ({ expect }) => {
    expect(
      csv.serialize([
        ["a", "b,c"],
        ['say "x"', "line\nbreak"],
      ]),
    ).toBe('﻿a,"b,c"\r\n"say ""x""","line\nbreak"\r\n');
  });

  it("round-trips what it writes", ({ expect }) => {
    const rows = [
      ["Name", "Note"],
      ["é, ü", '"quoted"'],
      ["", " padded "],
    ];
    expect(csv.parse(csv.serialize(rows)).rows).toEqual(rows);
  });

  it("writes a table: select by label, checkbox as true/false", ({
    expect,
  }) => {
    const text = csv.fromTable({
      columns: [
        { id: "n", name: "Name", type: "text" },
        { id: "d", name: "Done", type: "checkbox" },
        {
          id: "s",
          name: "Status",
          type: "select",
          options: { choices: [{ id: "o1", label: "Open" }] },
        },
        { id: "r", name: "See", type: "reference" },
      ],
      rows: [{ cells: { n: "a", d: true, s: "o1", r: "#Q12" } }, { cells: {} }],
    });
    expect(text).toBe("﻿Name,Done,Status,See\r\na,true,Open,#Q12\r\n,,,\r\n");
  });

  it("guesses number, date, checkbox, else text", ({ expect }) => {
    expect(csv.guessType(["1", "2.5", ""])).toBe("number");
    expect(csv.guessType(["2026-11-20", "2026-11-21T10:00:00Z"])).toBe("date");
    expect(csv.guessType(["TRUE", "false"])).toBe("checkbox");
    expect(csv.guessType(["1", "x"])).toBe("text");
    expect(csv.guessType(["", " "])).toBe("text");
    expect(csv.hasTime(["2026-11-20", "2026-11-21T10:00:00Z"])).toBe(true);
  });
});
