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
import { projects } from "../../api/entities/projects.ts";
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
 * Direct handle onto `projects`, so a spec can put the tree into a state
 * `createProject` refuses to create: two rows whose TITLES slugify alike.
 * The endpoint's `assertSlugAvailable` gate stops the second one on the way
 * in and the stored slugs end up disambiguated - which is exactly why the
 * resolver derives a slug from the title rather than reading the column.
 */
class ProjectsProbe {
  projects = $repository(projects);
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
  const projectsProbe = alepha.inject(ProjectsProbe);
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
    });
    return member.id;
  };

  const createProject = (title: string) =>
    asUser(OWNER, () =>
      projectApi.createProject({ body: { title } } as any),
    ) as Promise<{ id: number }>;

  /**
   * Resolve a `project_name` the way every tool does, under the owner's
   * identity - `getMyProjects` reads the caller.
   */
  const resolveName = (name: string) =>
    asUser(OWNER, () => projectTools.resolveProjectId(undefined, name));

  return {
    alepha,
    projectTools,
    project,
    call,
    OWNER,
    addNonOwnerMember,
    createProject,
    resolveName,
    projectsProbe,
  };
};

/**
 * ⚠️ These used to assert `isOwner`, and it was wrong twice over: derived
 * from `projects.createdBy`, which stopped being an authorization input in
 * epic #E39 and disagrees with the truth the moment a project is
 * transferred - and a boolean told an agent nothing it could act on, since it
 * could not know whether `release_create` would work without trying it and
 * reading the 403.
 */
describe("Lore MCP - projects", () => {
  describe("project_list", () => {
    it("names the caller's rank on every row", async ({ expect }) => {
      const { projectTools, project, call } = await setup();

      const result = await call(projectTools.project_list, {});
      const row = result.projects.find((p: any) => p.id === project.id);

      // The KEY and the NAME. A rank somebody created has an opaque key, so a
      // row carrying one without the other is carrying the wrong one.
      expect(row?.rank).toEqual({ key: "owner", name: "Owner" });
    });

    it("names a plain member's rank, and does not carry a permission set", async ({
      expect,
    }) => {
      const { projectTools, project, call, addNonOwnerMember } = await setup();
      const memberId = await addNonOwnerMember();

      const result = await call(projectTools.project_list, {}, memberId);
      const row = result.projects.find((p: any) => p.id === project.id);

      expect(row?.rank).toEqual({ key: "member", name: "Member" });
      // Deliberately absent: a set per row is one definitions read per
      // project, and "may I do this" is a question about ONE project.
      expect(row?.permissions).toBeUndefined();
    });
  });

  /**
   * The slug is the spelling an agent actually meets: it is in the URL, in a
   * pasted link, and in `SIGIL_KEY`. Before this, `resolveProjectId` compared
   * against titles only, so anything but a one-word title answered "not
   * found" - which reads as "you are not a member".
   */
  describe("project_name", () => {
    it("resolves a project from its slug and from its title", async ({
      expect,
    }) => {
      const { createProject, resolveName } = await setup();
      const kanban = await createProject("Kanban v2");

      await expect(resolveName("kanban-v2")).resolves.toBe(kanban.id);
      await expect(resolveName("Kanban v2")).resolves.toBe(kanban.id);
    });

    it("resolves an accented title from its folded slug", async ({
      expect,
    }) => {
      const { createProject, resolveName } = await setup();
      const elan = await createProject("Élan Vital");

      await expect(resolveName("elan-vital")).resolves.toBe(elan.id);
    });

    it("prefers an exact title over another project's slug", async ({
      expect,
    }) => {
      const { createProject, resolveName, projectsProbe } = await setup();
      // `Kanban V2` slugifies to `kanban-v2`, so both rows answer the name -
      // and the one literally called that has to win. The second title is set
      // through the probe because the slug it would claim is already taken.
      const spelled = await createProject("Kanban V2");
      const literal = await createProject("Literally the slug");
      await projectsProbe.projects.updateById(literal.id, {
        title: "kanban-v2",
      });

      await expect(resolveName("kanban-v2")).resolves.toBe(literal.id);
      expect(literal.id).not.toBe(spelled.id);
    });

    it("refuses when two titles slugify alike, rather than picking one", async ({
      expect,
    }) => {
      const { createProject, resolveName, projectsProbe } = await setup();
      const first = await createProject("Kanban v2");
      const second = await createProject("Kanban v2 bis");
      // `createProject` would refuse the collision, so it is made here the
      // way production gets one: a title that moves without its slug.
      await projectsProbe.projects.updateById(second.id, {
        title: "Kanban V2",
      });

      await expect(resolveName("kanban-v2")).rejects.toThrow(
        'Project "kanban-v2" not found',
      );
      // Not a fluke of an empty tree: both rows really do answer that slug.
      expect(first.id).not.toBe(second.id);
    });

    it("refuses an unknown name with the message it has always used", async ({
      expect,
    }) => {
      const { resolveName } = await setup();

      // ⚠️ The same string for "no such project" and "not yours". Nothing
      // here may make it say more.
      await expect(resolveName("nope")).rejects.toThrow(
        'Project "nope" not found',
      );
    });
  });

  describe("project_context", () => {
    it("carries the effective permission set, not a boolean", async ({
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

      // ⚠️ ENUMERATED, not `["*"]`. The owner's rank stores a wildcard, and
      // `ProjectPermissions.of` resolves it against what this project's
      // capabilities actually cover - so the set an agent reads is the set it
      // may attempt, rather than a wildcard it would have to interpret.
      expect(asOwner.permissions).toContain("project:delete");
      expect(asOwner.permissions).toContain("capability:manage");
      expect(asOwner.rank).toEqual({ key: "owner", name: "Owner" });

      // The whole point of the change: an agent reading this knows what it
      // may attempt BEFORE attempting it.
      expect(asMember.permissions).toContain("quest:create");
      expect(asMember.permissions).not.toContain("project:delete");
      expect(asMember.rank).toEqual({ key: "member", name: "Member" });
    });
  });
});
