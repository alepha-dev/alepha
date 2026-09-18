import { Alepha } from "alepha";
import { organizationMembers as members } from "alepha/api/organizations";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import {
  AlephaSecurity,
  currentUserAtom,
  type UserAccountToken,
} from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake } from "alepha/testing/faker";
import { describe, it } from "vitest";

import { ProjectController } from "../controllers/ProjectController.ts";
import { LoreApi } from "../index.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";
import { ProjectPermissions } from "./ProjectPermissions.ts";

/**
 * Direct handle onto `members`, to read the owner's membership row the way
 * the gate hands it to `ProjectPermissions.of()`.
 */
class MembersProbe {
  members = $repository(members);
}

/**
 * Pinned like every other lore spec: the ROOT vitest config sets a Postgres
 * `DATABASE_URL`, which this app's SQLite provider rejects.
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
  alepha.with(LoreApi);

  const probe = alepha.inject(MembersProbe);
  const projectApi = alepha.inject(ProjectController);
  const permissions = alepha.inject(ProjectPermissions);
  const projectSecurity = alepha.inject(ProjectSecurityService);
  const users = alepha.inject(UserService);
  await alepha.start();

  const owner = await users.createUser({ username: "owner" });
  const project = await alepha.context.run(() => {
    alepha.store.set(currentUserAtom, { id: owner.id, roles: ["user"] } as any);
    return projectApi.createProject({ body: { title: "Scoped" } } as any);
  });
  const member = await probe.members.findOne({
    where: {
      userId: { eq: owner.id },
      organizationId: {
        eq: await projectSecurity.organizationIdOf(project.id),
      },
    },
  });

  const of = (user: Partial<UserAccountToken>) =>
    permissions.of(
      project.id,
      { id: owner.id, roles: ["user"], ...user } as UserAccountToken,
      member,
    );

  return { of };
};

/**
 * `ProjectPermissions.of()` starts from `SecurityProvider.getPermissions(user)`,
 * which applies the caller's permission scope. It is the reader nobody listed
 * when the scope was designed, and the one that would regress silently if
 * `getPermissions` ever stopped reading the scope: a project page and the MCP
 * `project_context` tool would offer a scoped key actions it cannot take.
 */
describe("ProjectPermissions.of under a permission scope", () => {
  it("narrows an owner's project permissions to the scope", async ({
    expect,
  }) => {
    const { of } = await setup();

    const unscoped = await of({});
    expect(unscoped.permissions).toContain("quest:create");
    expect(unscoped.permissions).toContain("project:delete");

    const scoped = await of({ permissionScope: ["quest:create"] });
    expect(scoped.permissions).toEqual(["quest:create"]);

    const empty = await of({ permissionScope: [] });
    expect(empty.permissions).toEqual([]);
  });

  it("narrows a privileged identity too, whose ranks and capabilities are bypassed", async ({
    expect,
  }) => {
    const { of } = await setup();

    const privileged = await of({ ownership: false });
    expect(privileged.permissions).toContain("project:delete");

    const scoped = await of({
      ownership: false,
      permissionScope: ["quest:create"],
    });
    expect(scoped.permissions).toEqual(["quest:create"]);
  });
});
