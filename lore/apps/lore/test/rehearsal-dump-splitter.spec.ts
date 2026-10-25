import { DatabaseSync } from "node:sqlite";

import { describe, it } from "vitest";

import { DumpSplitter } from "../scripts/rehearsal/DumpSplitter.ts";

describe("DumpSplitter", () => {
  const splitter = new DumpSplitter();

  /**
   * A value the way `wrangler d1 export` writes it: quotes doubled, newlines
   * as `\n` inside a `replace(..., '\n', char(10))`.
   */
  const exported = (text: string): string =>
    `replace('${text.replace(/'/g, "''").replace(/\n/g, "\\n")}','\\n',char(10))`;

  const replay = (sql: string) => {
    const db: any = new DatabaseSync(":memory:");
    db.exec(
      'CREATE TABLE "folios" ("id" integer PRIMARY KEY, "title" text, "content" text NOT NULL, "blob" blob);',
    );
    for (const line of sql.split("\n")) {
      if (line.trim()) db.exec(line);
    }
    return db;
  };

  it("leaves a dump of short statements untouched", ({ expect }) => {
    const dump = `INSERT INTO "folios" ("id","title","content","blob") VALUES(1,'a','b',NULL);`;

    expect(splitter.split(dump)).toEqual({ sql: dump, rewritten: 0 });
  });

  it("rebuilds an over-long row exactly, quotes, newlines and emoji included", ({
    expect,
  }) => {
    const content = `It's "big"\n🙂 back\\slash, (paren), done.\n`.repeat(
      9_000,
    );
    const dump = [
      `INSERT INTO "folios" ("id","title","content","blob") VALUES(7,'Big, title',${exported(content)},X'0102');`,
      `INSERT INTO "folios" ("id","title","content","blob") VALUES(8,'small','tiny',NULL);`,
    ].join("\n");

    const { sql, rewritten } = splitter.split(dump);

    expect(rewritten).toBe(1);
    for (const line of sql.split("\n")) {
      expect(Buffer.byteLength(line)).toBeLessThanOrEqual(
        DumpSplitter.MAX_BYTES,
      );
    }
    const db = replay(sql);
    expect(db.prepare("SELECT COUNT(*) AS n FROM folios").get().n).toBe(2);
    const row = db
      .prepare(
        "SELECT title, content, hex(blob) AS blob FROM folios WHERE id = 7",
      )
      .get();
    expect(row.title).toBe("Big, title");
    expect(row.content).toBe(content);
    expect(row.blob).toBe("0102");
  });

  it("refuses an over-long statement it cannot read rather than pass it on", ({
    expect,
  }) => {
    const dump = `CREATE TABLE x (${"a text,".repeat(20_000)} b text);`;

    expect(() => splitter.split(dump)).toThrow("not an INSERT");
  });
});
