import {
  McpProjectScope,
  ProjectCapabilityController,
  ProjectController,
} from "@lore/core/api";
import { Alepha } from "alepha";
import { audits } from "alepha/api/audits";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaMcp } from "alepha/mcp";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake } from "alepha/testing/faker";
import { describe, it } from "vitest";

import { FeedbackController, LorePlanApi } from "../src/api/index.ts";
import { FeedbackTools, LorePlanMcp } from "../src/mcp/index.ts";
import { createTestMemberByProjectId } from "../src/testing/index.ts";

class AuditProbe {
  audits = $repository(audits);
}

/**
 * `feedback_submit` and `feedback_targets` (#Q3971): a member files a
 * feedback into another project they belong to that accepts feedback, even
 * from a run pinned to one project, and nowhere else.
 */
describe("feedback_submit", () => {
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
    alepha.with(LorePlanApi);
    alepha.with(LorePlanMcp);
    alepha.with(AuditProbe);

    const tools = alepha.inject(FeedbackTools);
    const users = alepha.inject(UserService);
    await alepha.start();

    const owner = await users.createUser({ username: "owner" });
    const member = await users.createUser({ username: "member" });

    const asUser = <R>(userId: string, fn: () => R, pinned?: number): R =>
      alepha.context.run(() => {
        alepha.store.set(currentUserAtom, { id: userId, roles: ["user"] });
        if (pinned !== undefined) {
          alepha.context.set(McpProjectScope.KEY, { pinned });
        }
        return fn();
      });

    const aProject = (title: string, feedbackOn: boolean) =>
      asUser(owner.id, () =>
        alepha.inject(ProjectController).createProject({
          body: {
            title,
            capabilities: [{ key: "plan", options: { feedback: feedbackOn } }],
          },
        }),
      );

    // The room's project, a project that takes feedback, one that does not,
    // and one the member is not in.
    const room = await aProject("Room", true);
    const open = await aProject("Open", true);
    const closed = await aProject("Closed", false);
    const foreign = await aProject("Foreign", true);
    for (const it of [room, open, closed]) {
      await createTestMemberByProjectId(alepha, it.id, member.id);
    }
    // The plan option, set as the owner does from Settings.
    await asUser(owner.id, () =>
      alepha.inject(ProjectCapabilityController).setCapability({
        params: { projectId: closed.id, key: "plan" },
        body: { enabled: true, options: { feedback: false } },
      }),
    );

    return { alepha, tools, member, room, open, closed, foreign, asUser };
  };

  it("lists as targets only the member's own projects that accept feedback", async ({
    expect,
  }) => {
    const t = await setup();
    const answer = await t.asUser(t.member.id, () =>
      (t.tools.feedback_targets as any).execute({}),
    );
    expect(
      answer.targets.map((it: { title: string }) => it.title).sort(),
    ).toEqual(["Open", "Room"]);
    await t.alepha.stop();
  });

  it("files into another project from a run pinned to the room, pending, tagged, and audited in the room too", async ({
    expect,
  }) => {
    const t = await setup();
    const filed = await t.asUser(
      t.member.id,
      () =>
        (t.tools.feedback_submit as any).execute({
          project: t.open.id,
          title: "The export drops dates",
          description: "Seen from the Room project.",
          tags: ["bug"],
          as: "lore-ai",
        }),
      t.room.id,
    );
    expect(filed.projectId).toBe(t.open.id);

    const stored = await t.asUser(t.member.id, () =>
      t.alepha.inject(FeedbackController).getFeedbackByShortId({
        params: { projectId: t.open.id, shortId: filed.shortId },
      }),
    );
    expect(stored).toMatchObject({
      status: "pending",
      tags: ["bug", "agent:lore-ai"],
    });

    const rows = await t.alepha
      .inject(AuditProbe)
      .audits.findMany({ where: { action: { eq: "submit-elsewhere" } } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ scopeId: String(t.room.id) });
    expect(rows[0].metadata).toMatchObject({ targetProjectId: t.open.id });
    await t.alepha.stop();
  });

  it("refuses a project without Support, and one the member is not in, whatever the model passes", async ({
    expect,
  }) => {
    const t = await setup();
    const submit = (project: number) =>
      t.asUser(
        t.member.id,
        () =>
          (t.tools.feedback_submit as any).execute({
            project,
            title: "Anything at all",
            description: "x",
          }),
        t.room.id,
      );
    await expect(submit(t.closed.id)).rejects.toThrow(/not accepting feedback/);
    await expect(submit(t.foreign.id)).rejects.toThrow(/not found/);
    await t.alepha.stop();
  });
});
