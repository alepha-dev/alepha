import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { InspectorRegistry, InspectorRunProvider } from "alepha/inspector";
import { afterEach, describe, it } from "vitest";

import { DevMcpSession } from "../services/DevMcpSession.ts";
import { NotesApp, startFixture } from "./fixtures/mcpFixtureApp.ts";

describe("alepha mcp: logs, emails and SMS", () => {
  const stops: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const stop of stops.splice(0)) await stop();
  });

  const fixture = async () => {
    const f = await startFixture();
    stops.push(f.stop);
    return f;
  };

  it("isolates one call's logs with a marker", async ({ expect }) => {
    const { call, app } = await fixture();

    const mark = await call("logs_mark");
    const marker = Number(/Marker: (-?\d+)/.exec(mark)?.[1]);
    expect(Number.isFinite(marker)).toBe(true);

    await app.inject(NotesApp).invite.run({
      body: { email: "ada@example.app", phone: "+33600000000" },
    });

    const tail = await call("logs_tail", { since: marker, text: "invit" });
    expect(tail.split("\n")).toHaveLength(2);
    expect(tail).toMatch(/^\d+ \S+ INFO \S+: inviting ada@example.app\n/);
    expect(tail).toContain("invited ada@example.app");

    expect(
      await call("logs_tail", { since: marker, text: "invit", level: "WARN" }),
    ).toMatch(/Nothing matching was logged after marker/);
  });

  it("says nothing was logged, not nothing matching, when since is the only filter", async ({
    expect,
  }) => {
    const { call } = await fixture();
    const marker = Number(/Marker: (-?\d+)/.exec(await call("logs_mark"))?.[1]);

    expect(await call("logs_tail", { since: marker })).toBe(
      `Nothing was logged after marker ${marker}.`,
    );
  });

  it("says a live run's total counts the restored history", async ({
    expect,
  }) => {
    const { call, app } = await fixture();
    const notes = app.inject(NotesApp);
    for (let i = 0; i < 12; i++) {
      (notes as any).log.info(`counted ${i}`);
    }

    const capped = await call("logs_tail", { text: "counted", limit: 5 });

    expect(capped.split("\n")[0]).toBe(
      "Showing the newest 5 of 12 matching entries (the total counts the previous run's restored history, numbered below zero); raise `limit` or narrow the filters for the rest.",
    );
  });

  it("pages through a burst after a marker instead of keeping one page", async ({
    expect,
  }) => {
    const { call, app } = await fixture();
    const marker = Number(/Marker: (-?\d+)/.exec(await call("logs_mark"))?.[1]);

    const notes = app.inject(NotesApp);
    for (let i = 0; i < 260; i++) {
      (notes as any).log.info(`burst ${i}`);
    }

    const tail = await call("logs_tail", {
      since: marker,
      text: "burst",
      limit: 1000,
    });
    const lines = tail.split("\n");
    expect(lines).toHaveLength(260);
    expect(lines[0]).toContain("burst 0");
    expect(lines[259]).toContain("burst 259");

    const capped = await call("logs_tail", { since: marker, text: "burst" });
    // After a marker everything counted is this run's: no history note.
    expect(capped).toMatch(
      /^Showing the newest 50 of 260 matching entries; raise/,
    );
  });

  it("reads an email and an SMS an action sent, by id", async ({ expect }) => {
    const { call, app } = await fixture();
    await app.inject(NotesApp).invite.run({
      body: { email: "ada@example.app", phone: "+33600000000" },
    });

    const list = await call("emails_list");
    const id = /^- (\S+) - to ada@example.app - "Your invitation"/.exec(
      list,
    )?.[1];
    expect(id).toMatch(/\.eml\.json$/);
    const email = await call("email_read", { id });
    expect(email).toContain("Subject: Your invitation");
    expect(email).toContain("http://localhost/accept?token=t0k3n");
    expect(email).toContain("--- text part ---");

    const sms = await call("sms_list");
    const smsId = /^- (\S+) - to \+33600000000/.exec(sms)?.[1];
    expect(await call("sms_read", { id: smsId })).toContain(
      "Your code is 424242",
    );
    expect(await call("email_read", { id: "nope" })).toMatch(/No email "nope"/);
  });

  it("tails a crashed run's logs from its file, and says other tools need it live", async ({
    expect,
  }) => {
    const { call, app, server } = await fixture();
    const own = await app.inject(InspectorRunProvider).entry();
    const runDir = app.inject(InspectorRegistry).directory();
    // A clean stop removes the entry; a crash leaves it, and its log file.
    await app.stop();
    const logFile = join(runDir, "crashed.jsonl");
    writeFileSync(
      logFile,
      `${JSON.stringify({ level: "ERROR", message: "last words before the crash", service: "s", module: "m", timestamp: 2 })}\n`,
    );
    writeFileSync(
      join(runDir, "crashed0.json"),
      JSON.stringify({
        ...own,
        runId: "crashed0",
        socket: "crashed0.sock",
        logFile,
      }),
    );

    const session = server.inject(DevMcpSession);
    expect((await session.selected())?.runId).toBe("crashed0");
    expect(await call("logs_tail", { text: "last words" })).toContain(
      "ERROR m: last words before the crash",
    );
    expect(await call("emails_list")).toMatch(/run \(crashed0\) is dead/);
  });
});
