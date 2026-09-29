import { Alepha } from "alepha";
import { AlephaApiUsers, RealmProvider } from "alepha/api/users";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { ConflictError } from "alepha/server";
import { describe, it } from "vitest";

import {
  AlephaApiOrganizations,
  MemberService,
  OrganizationService,
} from "../index.ts";

/**
 * The target leaves between the transfer's reads and its UPDATE: the race
 * the statement's own guard exists for.
 */
class TargetLeavesMemberService extends MemberService {
  protected override async swapRanks(
    organizationId: string,
    fromUserId: string,
    toUserId: string,
    keptRank: string,
  ): Promise<number> {
    await this.members.deleteMany({
      organizationId: { eq: organizationId },
      userId: { eq: toUserId },
    });
    return super.swapRanks(organizationId, fromUserId, toUserId, keptRank);
  }
}

const drivers = {
  // Transactions off, as on D1: only the statement's guard protects it.
  sqlite: () =>
    Alepha.create({
      env: {
        LOG_LEVEL: "error",
        DATABASE_URL: "sqlite://:memory:",
        DATABASE_TRANSACTIONS: false,
      },
    }),
  postgres: () =>
    Alepha.create({ env: { LOG_LEVEL: "error" } }).with(AlephaOrmPostgres),
};

const suite = (create: () => Alepha) => {
  const setup = async (options: { targetLeaves?: boolean } = {}) => {
    const alepha = create();
    if (options.targetLeaves) {
      alepha.with({ provide: MemberService, use: TargetLeavesMemberService });
    }
    alepha.with(AlephaApiUsers).with(AlephaApiOrganizations);
    await alepha.start();

    const users = alepha.inject(RealmProvider).userRepository();
    const owner = await users.create({ username: "transfer-owner" });
    const b = await users.create({ username: "transfer-b" });
    const c = await users.create({ username: "transfer-c" });
    const members = alepha.inject(MemberService);
    const organization = await alepha
      .inject(OrganizationService)
      .create({ name: "Acme" }, { id: owner.id });
    await members.add(organization.id, b.id, "member", { id: owner.id });
    await members.add(organization.id, c.id, "member", { id: owner.id });

    const owners = async () =>
      (await members.list(organization.id))
        .filter((it) => it.rank === MemberService.OWNER)
        .map((it) => it.userId);

    return { members, organization, owner, b, c, owners };
  };

  it("demotes nobody when the target leaves mid-transfer, and answers 409", async ({
    expect,
  }) => {
    const ctx = await setup({ targetLeaves: true });

    await expect(
      ctx.members.transfer(ctx.organization.id, ctx.b.id, "member", {
        id: ctx.owner.id,
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(await ctx.owners()).toEqual([ctx.owner.id]);
  });

  it("leaves exactly one owner after two concurrent transfers", async ({
    expect,
  }) => {
    const ctx = await setup();

    const results = await Promise.allSettled([
      ctx.members.transfer(ctx.organization.id, ctx.b.id, "member", {
        id: ctx.owner.id,
      }),
      ctx.members.transfer(ctx.organization.id, ctx.c.id, "member", {
        id: ctx.owner.id,
      }),
    ]);

    expect(results.filter((it) => it.status === "fulfilled")).toHaveLength(1);
    const owners = await ctx.owners();
    expect(owners).toHaveLength(1);
    expect([ctx.b.id, ctx.c.id]).toContain(owners[0]);
  });
};

describe("MemberService.transfer", () => {
  describe("sqlite without transactions", () => {
    suite(drivers.sqlite);
  });
  describe("postgres", () => {
    suite(drivers.postgres);
  });
});
