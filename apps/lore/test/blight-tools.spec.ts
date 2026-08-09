import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { AlephaMcp } from "alepha/mcp";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, expect, it } from "vitest";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { blights } from "../src/api/entities/blights.ts";
import { LoreApi } from "../src/api/index.ts";
import { LoreMcp } from "../src/mcp/index.ts";
import { BlightTools } from "../src/mcp/tools/BlightTools.ts";
import { QuestTools } from "../src/mcp/tools/QuestTools.ts";

/**
 * The blights inbox over MCP: triage happens in a conversation, and the
 * alternative is a browser.
 */

class Probe {
  blights = $repository(blights);
}

const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(AlephaMcp);
  alepha.with(LoreApi);
  alepha.with(LoreMcp);

  const probe = alepha.inject(Probe);
  const blightTools = alepha.inject(BlightTools);
  const questTools = alepha.inject(QuestTools);
  const projectApi = alepha.inject(ProjectController);
  const users = alepha.inject(UserService);
  await alepha.start();

  // A real user row: membership carries a foreign key to it, so a made-up id
  // fails the constraint rather than the authorization check.
  const owner = await users.createUser({ username: "owner" });
  const OWNER = owner.id;

  /*
    Runs a tool the way the transport does.

    `execute()` is the entry point, and the caller's identity does NOT travel
    as an argument — the controllers behind these tools read it from the
    request context. So the call has to happen inside one, with the user
    seeded exactly where `$secure` looks.
  */
  const asUser = <R>(userId: string, fn: () => R): R =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, { id: userId, roles: ["user"] } as any);
      return fn();
    });

  const call = (tool: any, params: Record<string, unknown>, userId = OWNER) =>
    asUser(userId, () => tool.execute(params));

  // Created through the controller, not by inserting a row: ownership lives in
  // a membership record, and `resolveProjectId` looks the project up among
  // the ones the caller belongs to. A bare row is a project nobody owns.
  const project = await asUser(OWNER, () =>
    projectApi.createProject({ body: { title: "Test" } } as any),
  );

  const otherProject = await asUser(OWNER, () =>
    projectApi.createProject({ body: { title: "Elsewhere" } } as any),
  );

  return {
    alepha,
    probe,
    blightTools,
    questTools,
    project,
    otherProject,
    call,
  };
};

describe("Lore MCP — blights", () => {
  /*
    The regression these guard: `listBlights` once read the live table while
    resolve, forward and delete looked rows up in a second, vestigial one. So
    every triage action answered "Blight not found", for a row the inbox had
    just displayed. One table, scoped by `projectId`, is what fixed it.
  */

  const fileBlight = async (
    probe: any,
    projectId: number,
    over: Record<string, unknown> = {},
  ) =>
    await probe.blights.create({
      projectId,
      fingerprint: "fp-1",
      name: "TypeError",
      message: "Cannot read properties of undefined",
      stack: "TypeError\n    at cart (app.js:1:1)",
      sourceUrl: "https://demo.example.com/cart",
      origin: "client",
      count: 7,
      firstSeenAt: "2026-08-01T10:00:00.000Z",
      lastSeenAt: "2026-08-01T10:05:00.000Z",
      ...over,
    } as any);

  it("should list everything the row carries, not a subset", async () => {
    // A schema is what serializes: any field the tool result schema omits is
    // silently dropped on the way out, however well the row is populated. This
    // asserts the whole payload an agent triages from survives the round trip.
    const { probe, blightTools, project, call } = await setup();
    await fileBlight(probe, project.id);

    const res = await call(blightTools.blight_list, { project: project.id });

    expect(res.openCount).toBe(1);
    expect(res.blights[0]).toMatchObject({
      fingerprint: "fp-1",
      name: "TypeError",
      message: "Cannot read properties of undefined",
      stack: "TypeError\n    at cart (app.js:1:1)",
      sourceUrl: "https://demo.example.com/cart",
      origin: "client",
      count: 7,
      status: "open",
    });
  });

  it("should hide resolved blights unless asked", async () => {
    const { probe, blightTools, project, call } = await setup();
    await fileBlight(probe, project.id, { status: "resolved" });

    const open = await call(blightTools.blight_list, { project: project.id });
    expect(open.blights).toHaveLength(0);
    expect(open.openCount).toBe(0);

    const all = await call(blightTools.blight_list, {
      project: project.id,
      include_resolved: true,
    });
    expect(all.blights).toHaveLength(1);
  });

  it("should resolve a blight the inbox just listed", async () => {
    // The exact case that was broken: list from one table, resolve against
    // another, "Blight not found".
    const { probe, blightTools, project, call } = await setup();
    const filed = await fileBlight(probe, project.id);

    const res = await call(blightTools.blight_resolve, {
      project: project.id,
      blight_id: filed.id,
    });

    expect(res.ok).toBe(true);
    const after = await call(blightTools.blight_list, {
      project: project.id,
    });
    expect(after.blights).toHaveLength(0);
  });

  it("should forward a blight into a quest and close it", async () => {
    const { probe, blightTools, project, call } = await setup();
    const filed = await fileBlight(probe, project.id);

    const res = await call(blightTools.blight_forward, {
      project: project.id,
      blight_id: filed.id,
    });

    expect(res.questShortId).toBeGreaterThan(0);
    const after = await call(blightTools.blight_list, {
      project: project.id,
    });
    expect(after.blights).toHaveLength(0);
  });

  it("should refuse a blight from another project", async () => {
    // Scoped by a WHERE clause on `projectId` rather than by walking the
    // project's sigils — one less step to get wrong. A real second project,
    // because `projectId` is a foreign key: an invented id fails on insert
    // and proves nothing about the scoping.
    const { probe, blightTools, project, call, otherProject } = await setup();
    const filed = await fileBlight(probe, otherProject.id);

    await expect(
      call(blightTools.blight_resolve, {
        project: project.id,
        blight_id: filed.id,
      }),
    ).rejects.toThrow();
  });

  it("should hand a blight back to the inbox when its quest is deleted", async () => {
    /*
      Forwarding is one-way: `blight_forward` refuses a row that already
      carries a `quest:` status. So deleting the quest used to strand the
      blight — out of the inbox because its status is not `open`, and
      un-forwardable because it looks handled. The failure kept happening with
      nothing left to surface it, and no triage action could reach it.

      Reopening here is not the same as letting a batch undo a decision (see
      `sigil-ingest.spec.ts`, "keeps a triage decision"). That rule protects a
      decision from NOISE; deleting the quest is the owner withdrawing it.
    */
    const { probe, blightTools, questTools, project, call } = await setup();
    const filed = await fileBlight(probe, project.id);

    const { questShortId } = await call(blightTools.blight_forward, {
      project: project.id,
      blight_id: filed.id,
    });
    expect((await probe.blights.findById(filed.id))?.status).toMatch(/^quest:/);

    await call(questTools.quest_delete, {
      project: project.id,
      shortId: questShortId,
    });

    expect((await probe.blights.findById(filed.id))?.status).toBe("open");
    const inbox = await call(blightTools.blight_list, {
      project: project.id,
    });
    expect(inbox.openCount).toBe(1);
  });

  it("should leave a blight alone when the deleted quest is not the one holding it", async () => {
    /*
      The guard on the reopen. Two quests, one blight: deleting the quest the
      blight is NOT pointing at must change nothing, or a tidy-up elsewhere in
      the project silently reopens triaged rows.
    */
    const { probe, blightTools, questTools, project, call } = await setup();
    const filed = await fileBlight(probe, project.id);

    await call(blightTools.blight_forward, {
      project: project.id,
      blight_id: filed.id,
    });
    const held = (await probe.blights.findById(filed.id))?.status;

    const unrelated = await call(questTools.quest_create, {
      project: project.id,
      title: "Unrelated",
      description: "Nothing to do with the blight",
      area: "misc",
      priority: "low",
      difficulty: 1,
    });
    await call(questTools.quest_delete, {
      project: project.id,
      shortId: unrelated.shortId,
    });

    expect((await probe.blights.findById(filed.id))?.status).toBe(held);
  });
});
