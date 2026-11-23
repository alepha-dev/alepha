import { describe, it } from "vitest";

import { StackTraceParser } from "./StackTraceParser.ts";

const parser = new StackTraceParser();

/**
 * The Errors page reads a stack, it does not dump it (#Q4186): the parser
 * turns the reported string into the chain of errors it prints.
 */
describe("StackTraceParser", () => {
  it("reads a V8 stack and the Caused by lines the sigil appends", ({
    expect,
  }) => {
    const stack = [
      "DbError: Query select has failed",
      "    at PostgresProvider.execute (file:///app/node_modules/alepha/dist/orm/index.js:120:11)",
      "    at async QuestService.list (/app/src/api/services/QuestService.ts:44:5)",
      "    at /app/src/api/controllers/QuestController.ts:12:3",
      "Caused by: SqliteError: no such column: quests.foo",
      "Caused by: Error: SQLITE_ERROR",
    ].join("\n");

    const chain = parser.parse(stack);

    expect(chain.map((it) => [it.name, it.message])).toEqual([
      ["DbError", "Query select has failed"],
      ["SqliteError", "no such column: quests.foo"],
      ["Error", "SQLITE_ERROR"],
    ]);
    expect(chain[0]!.frames).toHaveLength(3);
    expect(chain[0]!.frames[0]).toMatchObject({
      fn: "PostgresProvider.execute",
      file: "file:///app/node_modules/alepha/dist/orm/index.js",
      line: 120,
      column: 11,
      external: true,
    });
    expect(chain[0]!.frames[1]).toMatchObject({
      fn: "async QuestService.list",
      file: "/app/src/api/services/QuestService.ts",
      line: 44,
      external: false,
    });
    expect(chain[0]!.frames[2]).toMatchObject({
      file: "/app/src/api/controllers/QuestController.ts",
      line: 12,
      column: 3,
    });
    expect(chain[0]!.frames[2]!.fn).toBeUndefined();
  });

  it("nests a cause's own frames under it", ({ expect }) => {
    const stack = [
      "Error: outer",
      "    at a (/app/a.ts:1:1)",
      "Caused by: TypeError: inner",
      "    at b (/app/b.ts:2:2)",
    ].join("\n");

    const chain = parser.parse(stack);

    expect(chain).toHaveLength(2);
    expect(chain[1]!.frames.map((it) => it.fn)).toEqual(["b"]);
  });

  it("reads Firefox and Safari frames, and falls back to the record's header", ({
    expect,
  }) => {
    const stack = [
      "render@https://app.example/assets/index-Bx3kQ9aZ.js:2:1043",
      "@https://app.example/src/main.tsx:10:5",
    ].join("\n");

    const chain = parser.parse(stack, {
      name: "TypeError",
      message: "x is undefined",
    });

    expect(chain).toHaveLength(1);
    expect(chain[0]).toMatchObject({
      name: "TypeError",
      message: "x is undefined",
    });
    expect(chain[0]!.frames[0]).toMatchObject({
      fn: "render",
      file: "https://app.example/assets/index-Bx3kQ9aZ.js",
      line: 2,
      column: 1043,
      external: true,
    });
    expect(chain[0]!.frames[1]).toMatchObject({
      file: "https://app.example/src/main.tsx",
      external: false,
    });
  });

  it("keeps a multi-line message whole, and a line it cannot read as text", ({
    expect,
  }) => {
    const stack = [
      "DbError: Query failed",
      "select * from quests",
      "where id = ?",
      "    at q (/app/q.ts:1:1)",
      "    ... 3 more frames",
    ].join("\n");

    const [error] = parser.parse(stack);

    expect(error!.message).toBe(
      "Query failed\nselect * from quests\nwhere id = ?",
    );
    expect(error!.frames.map((it) => it.raw)).toEqual([
      "at q (/app/q.ts:1:1)",
      "... 3 more frames",
    ]);
  });

  it("tells somebody else's code from the app's own", ({ expect }) => {
    expect(parser.external("node:internal/process/task_queues")).toBe(true);
    expect(parser.external("/app/node_modules/react/index.js")).toBe(true);
    expect(parser.external("/assets/vendor.min.js")).toBe(true);
    expect(parser.external("/assets/ProjectErrors-CmF8a3Bx.js")).toBe(true);
    expect(parser.external("/app/src/user-controller.js")).toBe(false);
    expect(parser.external("/app/src/QuestService.ts")).toBe(false);
  });

  it("never loses an empty or unreadable stack", ({ expect }) => {
    expect(parser.parse("", { name: "Error", message: "boom" })).toEqual([
      { name: "Error", message: "boom", frames: [] },
    ]);
    expect(parser.parse("just some text")[0]).toMatchObject({
      name: "",
      message: "just some text",
    });
  });
});
