import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, expect, it } from "vitest";

import { FeedbackController } from "../src/api/controllers/FeedbackController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";
import { LoreMcp } from "../src/mcp/index.ts";
import { EpicTools } from "../src/mcp/tools/EpicTools.ts";
import { FolioTools } from "../src/mcp/tools/FolioTools.ts";
import { ProjectTools } from "../src/mcp/tools/ProjectTools.ts";
import { QuestTools } from "../src/mcp/tools/QuestTools.ts";
import { ReleaseTools } from "../src/mcp/tools/ReleaseTools.ts";

/**
 * `project_activity`: one call for everything that moved, which is what
 * would have prevented the 2026-08-21 missed comment outright.
 *
 * Same identity-injection shim as `quest-tools-comments.spec.ts`, with a
 * second account so "somebody else did this" is a real case rather than a
 * self-comparison.
 */
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

  const questTools = alepha.inject(QuestTools);
  const projectTools = alepha.inject(ProjectTools);
  const epicTools = alepha.inject(EpicTools);
  const releaseTools = alepha.inject(ReleaseTools);
  const folioTools = alepha.inject(FolioTools);
  const projectApi = alepha.inject(ProjectController);
  const feedbackApi = alepha.inject(FeedbackController);
  const users = alepha.inject(UserService);
  const dt = alepha.inject(DateTimeProvider);
  await alepha.start();

  const owner = await users.createUser({ username: "owner" });
  const mate = await users.createUser({ username: "mate" });
  const OWNER = owner.id;
  const MATE = mate.id;

  const asUser = <R>(userId: string, fn: () => R): R =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, { id: userId, roles: ["user"] } as any);
      return fn();
    });

  // mirrors quest-tools-comments.spec.ts's own tool-execute helper
  const call = (tool: any, params: Record<string, unknown>, userId = OWNER) =>
    asUser(userId, () => tool.execute(params));

  const project = await asUser(OWNER, () =>
    projectApi.createProject({
      body: {
        title: "Test",
        capabilities: [
          { key: "work" },
          { key: "knowledge" },
          { key: "support" },
        ],
      },
    } as any),
  );

  // The second account has to be a member before it can act on the project.
  // Direct repo insert, same as `project-leave.spec.ts`: the standard path
  // is through invitations, which is more plumbing than this needs.
  await (projectApi as any).members.create({
    userId: MATE,
    projectId: project.id,
    owner: false,
  });

  return {
    questTools,
    projectTools,
    epicTools,
    releaseTools,
    folioTools,
    projectApi,
    feedbackApi,
    project,
    call,
    asUser,
    dt,
    OWNER,
    MATE,
  };
};

/**
 * A timestamp far enough in the past to be a sane window start.
 */
const anHourAgo = (dt: DateTimeProvider) =>
  new Date(dt.nowMillis() - 60 * 60 * 1000).toISOString();

/**
 * One `(type, action)` pair per event, which is what an activity row is
 * identified by now that the feed reads recorded audit rows rather than
 * deriving events from six tables.
 */
const pairs = (res: { events: Array<{ type: string; action: string }> }) =>
  res.events.map((event) => `${event.type}:${event.action}`);

describe("Lore MCP: project_activity", () => {
  it("reports another member's comment and hides your own", async () => {
    const { questTools, projectTools, project, call, dt, MATE } = await setup();

    const quest = await call(questTools.quest_create, {
      project: project.id,
      title: "Wire the pipeline",
      description: "x",
      area: "core",
      priority: "medium",
    });

    const since = anHourAgo(dt);
    await call(questTools.quest_comment_add, { id: quest.id, body: "mine" });
    await call(
      questTools.quest_comment_add,
      { id: quest.id, body: "theirs" },
      MATE,
    );

    const res = await call(projectTools.project_activity, {
      project: project.id,
      since,
    });

    const comments = res.events.filter(
      (event: any) => event.type === "quest" && event.action === "comment",
    );
    expect(comments).toHaveLength(1);
    expect(comments[0].actor).toBe("mate");
    // The link target is the quest, addressed the way its page addresses it.
    expect(comments[0].resourceId).toBe(String(quest.shortId));
  });

  it("includes your own events on request", async () => {
    const { questTools, projectTools, project, call, dt } = await setup();

    const quest = await call(questTools.quest_create, {
      project: project.id,
      title: "Wire the pipeline",
      description: "x",
      area: "core",
      priority: "medium",
    });
    const since = anHourAgo(dt);
    await call(questTools.quest_comment_add, { id: quest.id, body: "mine" });

    const hidden = await call(projectTools.project_activity, {
      project: project.id,
      since,
    });
    expect(pairs(hidden)).not.toContain("quest:comment");

    const shown = await call(projectTools.project_activity, {
      project: project.id,
      since,
      includeOwn: true,
    });
    expect(pairs(shown)).toContain("quest:comment");
  });

  it("ignores anything older than since", async () => {
    const { questTools, projectTools, project, call, dt, MATE } = await setup();

    await call(
      questTools.quest_create,
      {
        project: project.id,
        title: "Old news",
        description: "x",
        area: "core",
        priority: "medium",
      },
      MATE,
    );

    // Everything above happened before this instant, so nothing may match.
    const since = new Date(dt.nowMillis() + 1000).toISOString();
    const res = await call(projectTools.project_activity, {
      project: project.id,
      since,
    });

    expect(res.events).toHaveLength(0);
    // With nothing to report the cursor stays where it was, so a caller
    // passing it back never skips over events it has not seen.
    expect(res.until).toBe(since);
  });

  it("never reports another project's events", async () => {
    const {
      questTools,
      projectTools,
      projectApi,
      project,
      call,
      asUser,
      dt,
      OWNER,
      MATE,
    } = await setup();

    const other = await asUser(OWNER, () =>
      projectApi.createProject({
        body: {
          title: "Other",
          capabilities: [
            { key: "work" },
            { key: "knowledge" },
            { key: "support" },
          ],
        },
      } as any),
    );
    await (projectApi as any).members.create({
      userId: MATE,
      projectId: other.id,
      owner: false,
    });

    const since = anHourAgo(dt);
    await call(
      questTools.quest_create,
      {
        project: other.id,
        title: "Belongs elsewhere",
        description: "x",
        area: "core",
        priority: "medium",
      },
      MATE,
    );

    const res = await call(projectTools.project_activity, {
      project: project.id,
      since,
    });

    // The scope is a WHERE on an indexed column pair, so this is structural
    // rather than a filter somebody has to remember to apply. Before the
    // event table existed the equivalent leak was real: the derived feed
    // loaded comments by quest id with no project predicate.
    expect(res.events).toHaveLength(0);
  });

  it("records the quest lifecycle as distinct actions", async ({ expect }) => {
    const { questTools, projectTools, project, call, dt, MATE } = await setup();

    const since = anHourAgo(dt);
    const quest = await call(
      questTools.quest_create,
      {
        project: project.id,
        title: "Ship it",
        description: "x",
        area: "core",
        priority: "medium",
      },
      MATE,
    );
    await call(questTools.quest_accept, { id: quest.id }, MATE);
    await call(questTools.quest_complete, { id: quest.id }, MATE);

    const res = await call(projectTools.project_activity, {
      project: project.id,
      since,
    });

    // Oldest first, so the order below IS the order things happened in.
    expect(pairs(res)).toEqual([
      "quest:create",
      "quest:accept",
      "quest:complete",
    ]);
  });

  it("reports feedback arrivals", async () => {
    const { feedbackApi, projectTools, project, call, asUser, dt, MATE } =
      await setup();

    const since = anHourAgo(dt);
    await asUser(MATE, () =>
      feedbackApi.submitFeedback({
        params: { projectId: project.id },
        body: {
          title: "It broke",
          description: "everywhere",
          type: "bug",
        },
      } as any),
    );

    const res = await call(projectTools.project_activity, {
      project: project.id,
      since,
    });

    expect(pairs(res)).toContain("feedback:create");
  });

  it("hands back a cursor that does not repeat what it already reported", async ({
    expect,
  }) => {
    const { questTools, projectTools, project, call, dt, MATE } = await setup();

    const since = anHourAgo(dt);
    await call(
      questTools.quest_create,
      {
        project: project.id,
        title: "First",
        description: "x",
        area: "core",
        priority: "medium",
      },
      MATE,
    );

    const first = await call(projectTools.project_activity, {
      project: project.id,
      since,
    });
    expect(first.events.length).toBeGreaterThan(0);

    const second = await call(projectTools.project_activity, {
      project: project.id,
      since: first.until,
    });
    // Strictly after the cursor, so the same event is never handed out twice.
    expect(second.events).toHaveLength(0);
  });

  it("carries no folio body on a folio event", async () => {
    const { folioTools, projectTools, project, call, dt, MATE } = await setup();

    const since = anHourAgo(dt);
    await call(
      folioTools.folio_create,
      {
        project: project.id,
        title: "Design notes",
        content: "SECRET-MARKER-DO-NOT-LEAK",
      },
      MATE,
    );

    const res = await call(projectTools.project_activity, {
      project: project.id,
      since,
    });

    expect(pairs(res)).toContain("folio:create");
    // The row carries the TITLE and never the body. A folio can be
    // end-to-end encrypted, and an unencrypted one is still member-gated
    // behind the folio itself; this feed is a wider surface than that.
    expect(JSON.stringify(res.events)).not.toContain("SECRET-MARKER");
  });
});

describe("Project activity table", () => {
  it("pages newest first and filters on the server", async ({ expect }) => {
    const { questTools, projectApi, project, call, asUser, OWNER, MATE } =
      await setup();

    const quest = await call(
      questTools.quest_create,
      {
        project: project.id,
        title: "Filterable",
        description: "x",
        area: "core",
        priority: "medium",
      },
      MATE,
    );
    await call(questTools.quest_accept, { id: quest.id }, MATE);
    await asUser(OWNER, () =>
      projectApi.updateProjectById({
        params: { id: project.id },
        body: { title: "Renamed" },
      } as any),
    );

    const all = await asUser(OWNER, () =>
      projectApi.getProjectActivity({
        params: { id: project.id },
        query: {},
      } as any),
    );
    // Newest first without asking, which is the question somebody opening
    // the page is holding.
    expect(all.content[0].type).toBe("project");
    expect(all.content[0].action).toBe("update");

    const byResource = await asUser(OWNER, () =>
      projectApi.getProjectActivity({
        params: { id: project.id },
        query: { type: "quest" },
      } as any),
    );
    expect(byResource.content.every((row: any) => row.type === "quest")).toBe(
      true,
    );

    const byWho = await asUser(OWNER, () =>
      projectApi.getProjectActivity({
        params: { id: project.id },
        query: { userId: MATE },
      } as any),
    );
    expect(byWho.content.every((row: any) => row.userId === MATE)).toBe(true);
    expect(byWho.content.length).toBeGreaterThan(0);

    const byAction = await asUser(OWNER, () =>
      projectApi.getProjectActivity({
        params: { id: project.id },
        query: { action: "accept" },
      } as any),
    );
    expect(pairsOf(byAction.content)).toEqual(["quest:accept"]);
  });

  it("resolves the actor to the same display name the quest page shows", async ({
    expect,
  }) => {
    const { questTools, projectApi, project, call, asUser, OWNER, MATE } =
      await setup();

    await call(
      questTools.quest_create,
      {
        project: project.id,
        title: "Named",
        description: "x",
        area: "core",
        priority: "medium",
      },
      MATE,
    );

    const page = await asUser(OWNER, () =>
      projectApi.getProjectActivity({
        params: { id: project.id },
        query: { userId: MATE },
      } as any),
    );

    expect(page.content[0].actor).toBe("mate");
    // The email snapshot stays on the row for the admin log and must not
    // reach a page every member of the project can open.
    expect(page.content[0]).not.toHaveProperty("userEmail");
  });
});

const pairsOf = (rows: Array<{ type: string; action: string }>) =>
  rows.map((row) => `${row.type}:${row.action}`);
