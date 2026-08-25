import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { AlephaMcp } from "alepha/mcp";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, it } from "vitest";

import { ProjectController } from "../../api/controllers/ProjectController.ts";
import { members } from "../../api/entities/members.ts";
import { LoreApi } from "../../api/index.ts";
import { LoreMcp } from "../index.ts";
import { ProjectTools } from "./ProjectTools.ts";

/**
 * Typed handle onto the `members` table for direct inserts, so a spec can
 * make a non-owner member without going through the invitation flow. Same
 * shape as the probe in `EpicTools.spec.ts`.
 */
class MembersProbe {
  members = $repository(members);
}

/**
 * Pinned, like every other lore spec: the ROOT vitest config sets
 * `DATABASE_URL` to a Postgres URL, which this app's SQLite provider
 * rejects outright.
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

  const membersProbe = alepha.inject(MembersProbe);
  const projectTools = alepha.inject(ProjectTools);
  const projectApi = alepha.inject(ProjectController);
  const users = alepha.inject(UserService);
  await alepha.start();

  const owner = await users.createUser({ username: "owner" });
  const OWNER = owner.id;

  const asUser = <R>(userId: string, fn: () => R): R =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, { id: userId, roles: ["user"] } as any);
      return fn();
    });

  const call = (tool: any, params: Record<string, unknown>, userId = OWNER) =>
    asUser(userId, () => tool.execute(params));

  const project = await asUser(OWNER, () =>
    projectApi.createProject({ body: { title: "Test" } } as any),
  );

  const addNonOwnerMember = async (): Promise<string> => {
    const member = await users.createUser({
      username: `member-${crypto.randomUUID().slice(0, 8)}`,
    });
    await membersProbe.members.create({
      userId: member.id,
      projectId: project.id,
      owner: false,
    });
    return member.id;
  };

  return { alepha, projectTools, project, call, OWNER, addNonOwnerMember };
};

describe("Lore MCP — projects", () => {
  describe("project_list", () => {
    it("reports isOwner true for the creator", async ({ expect }) => {
      const { projectTools, project, call } = await setup();

      const result = await call(projectTools.project_list, {});

      expect(
        result.projects.find((p: any) => p.id === project.id)?.isOwner,
      ).toBe(true);
    });

    it("reports isOwner false for a plain member", async ({ expect }) => {
      const { projectTools, project, call, addNonOwnerMember } = await setup();
      const memberId = await addNonOwnerMember();

      const result = await call(projectTools.project_list, {}, memberId);

      expect(
        result.projects.find((p: any) => p.id === project.id)?.isOwner,
      ).toBe(false);
    });
  });

  describe("project_context", () => {
    it("reports isOwner true for the creator and false for a plain member", async ({
      expect,
    }) => {
      const { projectTools, project, call, addNonOwnerMember } = await setup();
      const memberId = await addNonOwnerMember();

      const asOwner = await call(projectTools.project_context, {
        project: project.id,
      });
      const asMember = await call(
        projectTools.project_context,
        { project: project.id },
        memberId,
      );

      expect(asOwner.isOwner).toBe(true);
      expect(asMember.isOwner).toBe(false);
    });
  });
});
