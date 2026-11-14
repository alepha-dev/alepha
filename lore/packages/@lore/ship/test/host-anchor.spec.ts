import { projects } from "@lore/core/schemas";
import { Alepha } from "alepha";
import { MemberService } from "alepha/api/organizations";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, describe, type ExpectStatic, it } from "vitest";

import { LoreShipApi } from "../src/api/index.ts";
import { HostAnchorHooks } from "../src/api/services/HostAnchorHooks.ts";
import { appInstances, hostProjects, hosts } from "../src/schemas/index.ts";
import {
  createTestMemberByProjectId,
  createTestProject,
  DeployTestEntities,
} from "../src/testing/index.ts";

class Repositories {
  hosts = $repository(hosts);
  loans = $repository(hostProjects);
  instances = $repository(appInstances);
  projects = $repository(projects);
}

/**
 * An ownership transfer whose repoint never ran: the pre-delete hook must
 * still keep the host from going with the previous owner's account.
 */
class TransferRepointSkipped extends HostAnchorHooks {
  public override async repointTo(): Promise<void> {}
}

const setup = async (options: { skipTransferRepoint?: boolean } = {}) => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });
  if (options.skipTransferRepoint) {
    alepha.with({ provide: HostAnchorHooks, use: TransferRepointSkipped });
  }
  alepha
    .with(AlephaOrm)
    .with(AlephaServer)
    .with(AlephaSecurity)
    .with(AlephaEmail)
    .with(AlephaApiUsers)
    .with(LoreShipApi);
  const entities = alepha.inject(DeployTestEntities);
  const repos = alepha.inject(Repositories);
  await alepha.start();
  return { alepha, entities, repos };
};

/**
 * The cascade anchor of a homed host (#Q3278, epic #E126): it follows the
 * home project's owner, so the host outlives the account of whoever
 * created it or used to own the project.
 */
describe("the host cascade anchor", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const scenario = async (
    expect: ExpectStatic,
    skipTransferRepoint: boolean,
  ) => {
    const ctx = await setup({ skipTransferRepoint });
    alepha = ctx.alepha;
    const ann = await ctx.entities.users.create({ username: "ann" });
    const cat = await ctx.entities.users.create({ username: "cat" });
    const home = await createTestProject(ctx.alepha, { createdBy: ann.id });
    const borrower = await createTestProject(ctx.alepha, {
      createdBy: cat.id,
    });
    await createTestMemberByProjectId(ctx.alepha, home.id, cat.id);

    const host = await ctx.repos.hosts.create({
      ownerUserId: ann.id,
      createdBy: ann.id,
      projectId: home.id,
      type: "bay",
      slug: "vps-1",
    });
    await ctx.repos.loans.create({ hostId: host.id, projectId: home.id });
    await ctx.repos.loans.create({
      hostId: host.id,
      projectId: borrower.id,
    });
    const copy = await ctx.repos.instances.create({
      projectId: borrower.id,
      app: "api",
      env: "production",
      hostId: host.id,
    });

    await ctx.alepha
      .inject(MemberService)
      .transfer(home.organizationId!, cat.id, undefined, { id: ann.id });
    await ctx.alepha.inject(UserService).deleteUser(ann.id);

    const kept = await ctx.repos.hosts.findById(host.id);
    expect(kept).toBeDefined();
    expect(kept?.ownerUserId).toBe(cat.id);
    expect(kept?.projectId).toBe(home.id);
    expect(kept?.createdBy).toBeUndefined();
    expect(await ctx.repos.loans.count({ hostId: { eq: host.id } })).toBe(2);
    expect((await ctx.repos.instances.getById(copy.id)).hostId).toBe(host.id);
  };

  it("survives a transfer, then the previous owner deleting their account", async ({
    expect,
  }) => {
    await scenario(expect, false);
  });

  it("survives it too when the transfer's repoint never ran", async ({
    expect,
  }) => {
    await scenario(expect, true);
  });

  it("leaves a host with no home on its anchor, which goes with it", async ({
    expect,
  }) => {
    const ctx = await setup();
    alepha = ctx.alepha;
    const dan = await ctx.entities.users.create({ username: "dan" });
    const host = await ctx.repos.hosts.create({
      ownerUserId: dan.id,
      createdBy: dan.id,
      type: "bay",
      slug: "loose",
    });

    await ctx.alepha.inject(UserService).deleteUser(dan.id);

    expect(await ctx.repos.hosts.findById(host.id)).toBeUndefined();
  });
});
