import { projects } from "@lore/core/schemas";
import { Alepha } from "alepha";
import { MemberService } from "alepha/api/organizations";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, describe, type ExpectStatic, it } from "vitest";

import { LoreDeployApi } from "../src/api/index.ts";
import { EstateAnchorHooks } from "../src/api/services/EstateAnchorHooks.ts";
import { appInstances, estateProjects, estates } from "../src/schemas/index.ts";
import {
  createTestMemberByProjectId,
  createTestProject,
  DeployTestEntities,
} from "../src/testing/index.ts";

class Repositories {
  estates = $repository(estates);
  loans = $repository(estateProjects);
  instances = $repository(appInstances);
  projects = $repository(projects);
}

/**
 * An ownership transfer whose repoint never ran: the pre-delete hook must
 * still keep the estate from going with the previous owner's account.
 */
class TransferRepointSkipped extends EstateAnchorHooks {
  public override async repointTo(): Promise<void> {}
}

const setup = async (options: { skipTransferRepoint?: boolean } = {}) => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });
  if (options.skipTransferRepoint) {
    alepha.with({ provide: EstateAnchorHooks, use: TransferRepointSkipped });
  }
  alepha
    .with(AlephaOrm)
    .with(AlephaServer)
    .with(AlephaSecurity)
    .with(AlephaEmail)
    .with(AlephaApiUsers)
    .with(LoreDeployApi);
  const entities = alepha.inject(DeployTestEntities);
  const repos = alepha.inject(Repositories);
  await alepha.start();
  return { alepha, entities, repos };
};

/**
 * The cascade anchor of a homed estate (#Q3278, epic #E126): it follows the
 * home project's owner, so the estate outlives the account of whoever
 * created it or used to own the project.
 */
describe("the estate cascade anchor", () => {
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

    const estate = await ctx.repos.estates.create({
      ownerUserId: ann.id,
      createdBy: ann.id,
      projectId: home.id,
      type: "bay",
      slug: "vps-1",
    });
    await ctx.repos.loans.create({ estateId: estate.id, projectId: home.id });
    await ctx.repos.loans.create({
      estateId: estate.id,
      projectId: borrower.id,
    });
    const copy = await ctx.repos.instances.create({
      projectId: borrower.id,
      app: "api",
      env: "production",
      estateId: estate.id,
    });

    await ctx.alepha
      .inject(MemberService)
      .transfer(home.organizationId!, cat.id, undefined, { id: ann.id });
    await ctx.alepha.inject(UserService).deleteUser(ann.id);

    const kept = await ctx.repos.estates.findById(estate.id);
    expect(kept).toBeDefined();
    expect(kept?.ownerUserId).toBe(cat.id);
    expect(kept?.projectId).toBe(home.id);
    expect(kept?.createdBy).toBeUndefined();
    expect(await ctx.repos.loans.count({ estateId: { eq: estate.id } })).toBe(
      2,
    );
    expect((await ctx.repos.instances.getById(copy.id)).estateId).toBe(
      estate.id,
    );
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

  it("leaves an estate with no home on its anchor, which goes with it", async ({
    expect,
  }) => {
    const ctx = await setup();
    alepha = ctx.alepha;
    const dan = await ctx.entities.users.create({ username: "dan" });
    const estate = await ctx.repos.estates.create({
      ownerUserId: dan.id,
      createdBy: dan.id,
      type: "bay",
      slug: "loose",
    });

    await ctx.alepha.inject(UserService).deleteUser(dan.id);

    expect(await ctx.repos.estates.findById(estate.id)).toBeUndefined();
  });
});
