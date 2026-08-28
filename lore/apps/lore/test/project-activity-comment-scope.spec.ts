import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";
import { ProjectActivityService } from "../src/api/services/ProjectActivityService.ts";
import { LoreMcp } from "../src/mcp/index.ts";
import { ProjectTools } from "../src/mcp/tools/ProjectTools.ts";
import { QuestTools } from "../src/mcp/tools/QuestTools.ts";

/**
 * `project_activity` scopes comments in SQL, not in memory.
 *
 * `quest_comments` carries no `projectId`, and the first version of this read
 * every comment in the instance since the caller's `since`, looked their
 * quests up, and dropped the ones belonging to another project. The answer
 * was right; the cost grew with the whole deployment rather than with the
 * project being read.
 *
 * The events are identical either way, so asserting on them cannot tell the
 * two apart. What this pins is the query: the rows crossing the database
 * boundary must already be this project's.
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
  const projectApi = alepha.inject(ProjectController);
  const users = alepha.inject(UserService);
  const dt = alepha.inject(DateTimeProvider);
  const activity = alepha.inject(ProjectActivityService) as any;
  await alepha.start();

  const asUser = <R>(userId: string, fn: () => R): R =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, { id: userId, roles: ["user"] } as any);
      return fn();
    });

  const seedProject = async (username: string, title: string) => {
    const user = await users.createUser({ username });
    const project = await asUser(user.id, () =>
      projectApi.createProject({ body: { title } } as any),
    );
    return { userId: user.id, projectId: project.id };
  };

  const call = (tool: any, params: Record<string, unknown>, userId: string) =>
    asUser(userId, () => tool.execute(params));

  return { questTools, projectTools, activity, dt, call, seedProject };
};

const anHourAgo = (dt: DateTimeProvider) =>
  new Date(dt.nowMillis() - 60 * 60 * 1000).toISOString();

describe("project_activity comment scoping", () => {
  it("does not load another project's comments", async ({ expect }) => {
    const { questTools, projectTools, activity, dt, call, seedProject } =
      await setup();

    const mine = await seedProject("mine", "Mine");
    const other = await seedProject("other", "Other");

    const newQuest = (owner: typeof mine, title: string) =>
      call(
        questTools.quest_create,
        {
          project: owner.projectId,
          title,
          description: "x",
          area: "core",
          priority: "medium",
        },
        owner.userId,
      );

    const mineQuest = await newQuest(mine, "Wire the pipeline");
    const otherQuest = await newQuest(other, "Somebody else's quest");

    const since = anHourAgo(dt);
    await call(
      questTools.quest_comment_add,
      { id: mineQuest.id, body: "in scope" },
      mine.userId,
    );
    await call(
      questTools.quest_comment_add,
      { id: otherQuest.id, body: "OUT OF SCOPE" },
      other.userId,
    );

    // Plain assignment around the repository, not `vi.spyOn`: what is under
    // test is which rows crossed the database boundary, and the call is the
    // only place that is visible.
    const repository = activity.comments;
    const loaded: unknown[][] = [];
    activity.comments = {
      findMany: async (query: Record<string, unknown>) => {
        const rows = await repository.findMany(query);
        loaded.push(rows);
        return rows;
      },
    };

    const res = await call(
      projectTools.project_activity,
      { project: mine.projectId, since, includeOwn: true },
      mine.userId,
    );

    const comments = res.events.filter(
      (e: any) => e.kind === "quest.commented",
    );
    expect(comments).toHaveLength(1);
    expect(comments[0].quest.shortId).toBe(mineQuest.shortId);

    // The point of the test: the other project's comment was never read,
    // rather than read and then discarded.
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toHaveLength(1);
    expect(JSON.stringify(loaded[0])).not.toContain("OUT OF SCOPE");
  });
});
