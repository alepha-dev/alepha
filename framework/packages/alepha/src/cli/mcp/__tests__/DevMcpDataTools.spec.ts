import { AlephaApiJobsQueue } from "alepha/api/jobs";
import {
  InspectorClient,
  InspectorConnection,
  type InspectorRun,
} from "alepha/inspector";
import { McpServerProvider } from "alepha/mcp";
import { afterEach, describe, it } from "vitest";

import { NotesApp, startFixture } from "./fixtures/mcpFixtureApp.ts";

/**
 * Every request a tool sends to the app, by method and path.
 */
const sent: string[] = [];

class RecordingConnection extends InspectorConnection {
  protected override send(method: string, path: string, body: unknown) {
    sent.push(`${method} ${path.split("?")[0]}`);
    return super.send(method, path, body);
  }
}

class RecordingInspectorClient extends InspectorClient {
  public override connect(run: InspectorRun): InspectorConnection {
    super.connect(run);
    return new RecordingConnection(run, this.registry, this.dateTime);
  }
}

describe("alepha mcp: db_rows and the job tools", () => {
  const stops: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const stop of stops.splice(0)) await stop();
  });

  const fixture = async () => {
    const f = await startFixture(
      [NotesApp, AlephaApiJobsQueue],
      [{ provide: InspectorClient, use: RecordingInspectorClient }],
    );
    stops.push(f.stop);
    const repo = f.app.inject(NotesApp).repo;
    await repo.create({ title: "alpha", shareToken: "tok_alpha" });
    await repo.create({ title: "beta", shareToken: "tok_beta" });
    await repo.create({ title: "beta" });
    return f;
  };

  describe("db_rows", () => {
    it("reads rows with secret columns redacted, sorted and sized", async ({
      expect,
    }) => {
      const { call } = await fixture();

      const text = await call("db_rows", {
        entity: "mcp_fixture_notes",
        sort: "-id",
        size: 2,
      });
      const [head, ...rows] = text.split("\n");
      expect(head).toBe(
        "2 rows of 3 from mcp_fixture_notes (shareToken redacted)",
      );
      expect(rows.map((row) => JSON.parse(row).title)).toEqual([
        "beta",
        "beta",
      ]);
      expect(text).not.toContain("tok_");
      expect(JSON.parse(rows[1]).shareToken).toBe("[redacted]");
    });

    it("filters by equality, and refuses an unknown or a secret column", async ({
      expect,
    }) => {
      const { call } = await fixture();

      const alpha = await call("db_rows", {
        entity: "mcp_fixture_notes",
        where: { title: "alpha" },
      });
      expect(alpha.split("\n")).toHaveLength(2);
      expect(alpha).toContain('"title":"alpha"');

      expect(
        await call("db_rows", {
          entity: "mcp_fixture_notes",
          where: { colour: "red" },
        }),
      ).toBe(
        'Not read: "mcp_fixture_notes" has no column "colour". Columns: id, title, shareToken',
      );
      expect(
        await call("db_rows", {
          entity: "mcp_fixture_notes",
          where: { shareToken: "tok_alpha" },
        }),
      ).toMatch(/^Refused: shareToken is secret/);
      expect(await call("db_rows", { entity: "nope" })).toMatch(
        /^No entity "nope". Entities: .*mcp_fixture_notes/,
      );
    });
  });

  describe("jobs", () => {
    it("lists jobs, triggers one with a payload, reads its executions and retries one", async ({
      expect,
    }) => {
      const { call } = await fixture();

      expect(await call("jobs_list")).toContain('"name":"notes.sweep"');
      expect(
        await call("job_trigger", {
          job: "notes.fail",
          payload: { reason: "disk full" },
        }),
      ).toBe('Triggered "notes.fail".');

      let executions = "";
      for (
        let i = 0;
        i < 100 && !executions.includes('"status":"error"');
        i++
      ) {
        await new Promise((r) => setTimeout(r, 50));
        executions = await call("job_executions", {
          job: "notes.fail",
          status: "error",
        });
      }
      expect(executions).toContain('"status":"error"');
      expect(executions).toContain("disk full");
      const id = /"id":"([^"]+)"/.exec(executions)?.[1];

      expect(await call("job_retry", { execution: id })).toBe(
        `Retrying execution ${id}.`,
      );
      expect(await call("job_executions", { job: "nope" })).toMatch(
        /^Not read: Job not found: nope/,
      );
    });
  });

  it("never reaches the inspector's row writes, from any tool", async ({
    expect,
  }) => {
    const { call, server } = await fixture();
    const samples: Record<string, Record<string, unknown>> = {
      apps_list: {},
      app_select: { app: process.cwd() },
      app_map: {},
      app_describe: { kind: "entity", name: "mcp_fixture_notes" },
      logs_tail: {},
      logs_mark: {},
      emails_list: {},
      email_read: { id: "x" },
      sms_list: {},
      sms_read: { id: "x" },
      action_call: {
        action: "getNote",
        params: { id: 1 },
        as: { roles: ["admin"] },
      },
      db_rows: { entity: "mcp_fixture_notes", where: { title: "beta" } },
      jobs_list: {},
      job_executions: { job: "notes.sweep" },
      job_trigger: { job: "notes.sweep", payload: { olderThanDays: 1 } },
      job_retry: { execution: "x" },
      docs_search: { text: "entity" },
      docs_read: {},
    };
    const tools = server
      .inject(McpServerProvider)
      .getTools()
      .map((tool) => tool.name);
    // A new tool must be added here, so this check covers it.
    expect(Object.keys(samples).sort()).toEqual([...tools].sort());

    sent.length = 0;
    for (const [name, params] of Object.entries(samples)) {
      await call(name, params);
    }
    expect(sent).toContain("GET /db/mcp_fixture_notes/records");
    expect(sent).toContain("POST /jobs/notes.sweep/trigger");
    const writes = sent.filter(
      (request) => request.includes(" /db/") && !request.startsWith("GET "),
    );
    expect(writes).toEqual([]);
  });
});
