import { afterEach, describe, it } from "vitest";

import { FIXTURE_SECRET, startFixture } from "./fixtures/mcpFixtureApp.ts";

describe("alepha mcp: app_map and app_describe", () => {
  const stops: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const stop of stops.splice(0)) await stop();
  });

  const fixture = async () => {
    const f = await startFixture();
    stops.push(f.stop);
    return f;
  };

  it("maps the running app, one line per item and no schemas", async ({
    expect,
  }) => {
    const { call } = await fixture();
    const map = await call("app_map");

    expect(map).toContain("read from the running app by `alepha mcp`");
    expect(map).toMatch(/Sections: actions \(\d+\), entities/);
    expect(map).not.toContain("routes (");
    expect(map).toContain("`NotesApp.getNote` (secure): Read one note");
    expect(map).toContain("- `mcp_fixture_notes`: id, title, shareToken");
    expect(map).toContain("`notes.sweep` (queue mode");
    expect(map).toContain("## Modules (");
    expect(map).toContain("## Permissions (");
    expect(map).not.toContain("response:");
  });

  it("prints one section in full, and filters", async ({ expect }) => {
    const { call } = await fixture();

    const entities = await call("app_map", { section: "entities" });
    expect(entities).toContain("| shareToken | text | secret |");

    const filtered = await call("app_map", { filter: "getNote" });
    expect(filtered).toContain('## Actions (1 matching "getNote")');
  });

  it("describes an action with its types, $secure rule and declared errors", async ({
    expect,
  }) => {
    const { call } = await fixture();

    for (const name of ["NotesApp.getNote", "getNote", "GET /api/notes/:id"]) {
      const text = await call("app_describe", { kind: "action", name });
      expect(text).toContain("### GET /api/notes/:id");
      expect(text).toContain("- params: `{ id: number }`");
      expect(text).toContain("- response: `{ id: number; title: string }`");
      expect(text).toContain("- secure: a signed-in user; roles admin");
      expect(text).toContain("- errors: NOTE_MISSING (404)");
    }
  });

  it("describes a page, an entity and a job, and suggests on a miss", async ({
    expect,
  }) => {
    const { call } = await fixture();

    expect(await call("app_describe", { kind: "page", name: "home" })).toBe(
      "- `home` `/`",
    );
    expect(
      await call("app_describe", { kind: "entity", name: "mcp_fixture_notes" }),
    ).toContain("| id | integer | primary key");
    expect(
      await call("app_describe", { kind: "job", name: "notes.sweep" }),
    ).toContain("payload `{ olderThanDays: number }`");
    expect(
      await call("app_describe", { kind: "action", name: "note" }),
    ).toMatch(/No single action is named "note". Closest: NotesApp.getNote/);
  });

  it("never returns an env value, from either tool", async ({ expect }) => {
    const { call } = await fixture();

    const outputs = [
      await call("app_map"),
      await call("app_map", { section: "env" }),
      await call("app_map", { section: "atoms" }),
    ];
    for (const output of outputs) {
      expect(output).not.toContain(FIXTURE_SECRET);
    }
    expect(outputs[1]).toContain("| MCP_FIXTURE_SECRET? | string |");
  });
});
