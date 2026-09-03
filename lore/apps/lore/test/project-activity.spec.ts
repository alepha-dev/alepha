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
    projectApi.createProject({ body: { title: "Test" } } as any),
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
      (e: any) => e.kind === "quest.commented",
    );
    expect(comments).toHaveLength(1);
    expect(comments[0].actor).toBe("mate");
    expect(comments[0].quest.shortId).toBe(quest.shortId);
    // Written through MCP, so it is marked as machine-authored.
    expect(comments[0].actorKind).toBe("agent");
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
    expect(
      hidden.events.filter((e: any) => e.kind === "quest.commented"),
    ).toHaveLength(0);

    const shown = await call(projectTools.project_activity, {
      project: project.id,
      since,
      includeOwn: true,
    });
    expect(
      shown.events.filter((e: any) => e.kind === "quest.commented"),
    ).toHaveLength(1);
  });

  it("ignores anything older than since", async () => {
    const { questTools, projectTools, project, call, dt, MATE } = await setup();

    const quest = await call(questTools.quest_create, {
      project: project.id,
      title: "Old news",
      description: "x",
      area: "core",
      priority: "medium",
    });
    await call(
      questTools.quest_comment_add,
      { id: quest.id, body: "before" },
      MATE,
    );

    // A window opening after everything above happened.
    const since = new Date(dt.nowMillis() + 1000).toISOString();
    const res = await call(projectTools.project_activity, {
      project: project.id,
      since,
    });

    expect(res.events).toEqual([]);
    expect(res.truncated).toBe(false);
    // With nothing to report the cursor stays where it was, so a caller
    // passing `until` back never skips over events it has not seen.
    expect(res.until).toBe(res.since);
  });

  it("derives quest lifecycle from history and the timestamp columns", async () => {
    const { questTools, projectTools, project, call, dt, MATE } = await setup();

    const since = anHourAgo(dt);
    const quest = await call(
      questTools.quest_create,
      {
        project: project.id,
        title: "Lifecycle",
        description: "x",
        area: "core",
        priority: "medium",
        accept: true,
      },
      MATE,
    );
    await call(questTools.quest_complete, { id: quest.id }, MATE);

    const res = await call(projectTools.project_activity, {
      project: project.id,
      since,
    });

    const kinds = res.events.map((e: any) => e.kind);
    // `created` and `completed` write no history row and come off the
    // timestamp columns; `accepted` is the `assigned` history entry.
    expect(kinds).toContain("quest.created");
    expect(kinds).toContain("quest.accepted");
    expect(kinds).toContain("quest.completed");
    // Oldest first.
    expect(kinds.indexOf("quest.created")).toBeLessThan(
      kinds.indexOf("quest.completed"),
    );
  });

  it("reports feedback arrivals", async () => {
    const { projectTools, feedbackApi, project, call, asUser, dt, MATE } =
      await setup();

    const since = anHourAgo(dt);
    await asUser(MATE, () =>
      feedbackApi.submitFeedback({
        params: { projectId: project.id },
        body: { title: "It crashes", description: "x" },
      } as any),
    );

    const res = await call(projectTools.project_activity, {
      project: project.id,
      since,
    });

    const reported = res.events.filter(
      (e: any) => e.kind === "feedback.created",
    );
    expect(reported).toHaveLength(1);
    expect(reported[0].feedback.title).toBe("It crashes");
    expect(reported[0].actor).toBe("mate");
  });

  it("clamps a since older than the window and says so", async () => {
    const { projectTools, project, call } = await setup();

    const res = await call(projectTools.project_activity, {
      project: project.id,
      since: "2020-01-01T00:00:00.000Z",
    });

    expect(res.sinceClamped).toBe(true);
    expect(Date.parse(res.since)).toBeGreaterThan(
      Date.parse("2020-01-01T00:00:00.000Z"),
    );
  });

  it("truncates at the limit and hands back a usable cursor", async () => {
    const { questTools, projectTools, project, call, dt, MATE } = await setup();

    const since = anHourAgo(dt);
    for (let i = 0; i < 4; i++) {
      await call(
        questTools.quest_create,
        {
          project: project.id,
          title: `Quest ${i}`,
          description: "x",
          area: "core",
          priority: "medium",
        },
        MATE,
      );
    }

    const first = await call(projectTools.project_activity, {
      project: project.id,
      since,
      limit: 2,
    });
    expect(first.events).toHaveLength(2);
    expect(first.truncated).toBe(true);
    expect(first.until).toBe(first.events[1].at);

    const next = await call(projectTools.project_activity, {
      project: project.id,
      since: first.until,
    });
    // Nothing from the first page comes back twice.
    expect(
      next.events.every((e: any) => Date.parse(e.at) > Date.parse(first.until)),
    ).toBe(true);
  });

  it("reports an epic being opened", async () => {
    const { epicTools, projectTools, project, call, dt } = await setup();

    const since = anHourAgo(dt);
    const epic = await call(epicTools.epic_create, {
      project: project.id,
      title: "Activity feed",
      description: "x",
    });

    const res = await call(projectTools.project_activity, {
      project: project.id,
      since,
      includeOwn: true,
    });

    const events = res.events.filter((e: any) => e.kind === "epic.created");
    expect(events).toHaveLength(1);
    expect(events[0].epic).toEqual({
      number: epic.number,
      title: "Activity feed",
    });
    // `number`, not `shortId`: an epic's per-project identifier is its
    // number, and that is what the URL segment needs.
    expect(events[0].epic.shortId).toBeUndefined();
  });

  it("reports an epic that was created AND changed as two events", async ({
    expect,
  }) => {
    const { epicTools, projectTools, project, call, dt } = await setup();

    const since = anHourAgo(dt);
    const epic = await call(epicTools.epic_create, {
      project: project.id,
      title: "Two things happened",
      description: "x",
    });
    await call(epicTools.epic_set_status, {
      project: project.id,
      number: epic.number,
      status: "active",
    });

    const res = await call(projectTools.project_activity, {
      project: project.id,
      since,
      includeOwn: true,
    });

    // Collapsing these to one event hides the more recent fact behind the
    // older one: an epic created last week and activated this morning would
    // report only its creation, on a page whose whole job is what just
    // moved.
    const kinds = res.events
      .filter((e: any) => e.kind.startsWith("epic."))
      .map((e: any) => e.kind);
    expect(kinds).toEqual(["epic.created", "epic.updated"]);
  });

  it("separates a release being opened from a release being published", async () => {
    const { releaseTools, projectTools, project, call, dt } = await setup();

    const since = anHourAgo(dt);
    await call(releaseTools.release_create, {
      project: project.id,
      tag: "0.1.0",
      title: "First",
    });
    await call(releaseTools.release_publish, {
      project: project.id,
      tag: "0.1.0",
    });

    const res = await call(projectTools.project_activity, {
      project: project.id,
      since,
      includeOwn: true,
    });

    // Created and published inside one window yields both, in that order:
    // it is the true story of the window, not a duplicate.
    const kinds = res.events
      .filter((e: any) => e.kind.startsWith("release."))
      .map((e: any) => e.kind);
    expect(kinds).toEqual(["release.created", "release.published"]);

    const published = res.events.find(
      (e: any) => e.kind === "release.published",
    );
    expect(published.release.tag).toBe("0.1.0");
  });

  it("carries no folio body on a folio event", async () => {
    const { folioTools, projectTools, project, call, dt } = await setup();

    const since = anHourAgo(dt);
    const body = "a body long enough to notice ".repeat(40);
    await call(folioTools.folio_create, {
      project: project.id,
      title: "Notes",
      content: body,
    });

    const res = await call(projectTools.project_activity, {
      project: project.id,
      since,
      includeOwn: true,
    });

    const event = res.events.find((e: any) => e.kind === "folio.updated");
    expect(event).toBeDefined();
    // The projection guard. `folio_revisions.contentSnapshot` is a whole
    // copy of the folio body and is ~30% of production's database; nothing
    // here reads it, so nothing here may carry it. A regression would be
    // invisible except as bandwidth.
    expect(JSON.stringify(event)).not.toContain("long enough to notice");
  });
});
