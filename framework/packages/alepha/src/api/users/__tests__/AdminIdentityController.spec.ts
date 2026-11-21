import { Alepha } from "alepha";
import { DbEntityNotFoundError, AlephaOrmTestPostgres } from "alepha/orm";
import { AlephaSecurity, type UserAccountToken } from "alepha/security";
import { describe, it } from "vitest";

import {
  AdminIdentityController,
  AlephaApiUsers,
  IdentityService,
  UserService,
} from "../index.ts";

const adminUser: UserAccountToken = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Test Admin",
  roles: ["admin"],
};

const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error" },
  });

  alepha.with(AlephaOrmTestPostgres);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaApiUsers);

  await alepha.start();

  return {
    alepha,
    identityService: alepha.inject(IdentityService),
    userService: alepha.inject(UserService),
    controller: alepha.inject(AdminIdentityController),
  };
};

describe("alepha/api/users - AdminIdentityController", () => {
  it("should get an identity by ID", async ({ expect }) => {
    const { identityService, userService, controller } = await setup();

    // Create a test user
    const user = await userService.users().create({
      username: "identityuser",
      email: "identity@example.com",
      roles: ["user"],
    });

    // Create an identity
    const identity = await identityService.identities().create({
      userId: user.id,
      provider: "google",
      providerUserId: "google-123456",
      providerData: {
        name: "Test User",
        picture: "https://example.com/photo.jpg",
      },
    });

    const result = await controller.getIdentity(
      {
        params: { id: identity.id },
      },
      { user: adminUser },
    );

    expect(result.id).toBe(identity.id);
    expect(result.userId).toBe(user.id);
    expect(result.provider).toBe("google");
    expect(result.providerUserId).toBe("google-123456");
    // Of `providerData`, only the keys the resource schema lists: what a
    // provider handed back stays in the table.
    expect(result.providerData).toEqual({ name: "Test User" });
    expect("password" in result).toBe(false);
  });

  it("should throw error for non-existent identity", async ({ expect }) => {
    const { controller } = await setup();

    await expect(
      controller.getIdentity(
        {
          params: { id: "550e8400-e29b-41d4-a716-446655440000" },
        },
        { user: adminUser },
      ),
    ).rejects.toThrow(DbEntityNotFoundError);
  });

  it("should delete an identity", async ({ expect }) => {
    const { identityService, userService, controller } = await setup();

    const user = await userService.users().create({
      username: "deleteidentityuser",
      email: "deleteidentity@example.com",
      roles: ["user"],
    });

    const identity = await identityService.identities().create({
      userId: user.id,
      provider: "github",
      providerUserId: "github-789",
    });

    const result = await controller.deleteIdentity(
      {
        params: { id: identity.id },
      },
      { user: adminUser },
    );

    expect(result.ok).toBe(true);
    expect(result.id).toBe(identity.id);

    // Verify identity is deleted
    await expect(
      controller.getIdentity(
        {
          params: { id: identity.id },
        },
        { user: adminUser },
      ),
    ).rejects.toThrow(DbEntityNotFoundError);
  });

  it("should find identities with pagination", async ({ expect }) => {
    const { identityService, userService, controller } = await setup();

    const user = await userService.users().create({
      username: "multiidentityuser",
      email: "multiidentity@example.com",
      roles: ["user"],
    });

    // Create multiple identities
    const identity1 = await identityService.identities().create({
      userId: user.id,
      provider: "google",
      providerUserId: "google-1",
    });
    const identity2 = await identityService.identities().create({
      userId: user.id,
      provider: "github",
      providerUserId: "github-1",
    });
    const identity3 = await identityService.identities().create({
      userId: user.id,
      provider: "apple",
      providerUserId: "apple-1",
    });

    const result = await controller.findIdentities(
      {
        query: { userId: user.id },
      },
      { user: adminUser },
    );

    expect(result.content.length).toBeGreaterThanOrEqual(3);

    // Verify all created identities are in the results
    const identityIds = result.content.map((i) => i.id);
    expect(identityIds).toContain(identity1.id);
    expect(identityIds).toContain(identity2.id);
    expect(identityIds).toContain(identity3.id);
  });

  it("should filter identities by userId", async ({ expect }) => {
    const { identityService, userService, controller } = await setup();

    const user1 = await userService.users().create({
      username: "user1identity",
      email: "user1identity@example.com",
      roles: ["user"],
    });
    const user2 = await userService.users().create({
      username: "user2identity",
      email: "user2identity@example.com",
      roles: ["user"],
    });

    await identityService.identities().create({
      userId: user1.id,
      provider: "google",
      providerUserId: "google-user1-1",
    });
    await identityService.identities().create({
      userId: user1.id,
      provider: "github",
      providerUserId: "github-user1-1",
    });
    await identityService.identities().create({
      userId: user2.id,
      provider: "google",
      providerUserId: "google-user2-1",
    });

    const result = await controller.findIdentities(
      {
        query: { userId: user1.id },
      },
      { user: adminUser },
    );

    expect(result.content.every((i) => i.userId === user1.id)).toBe(true);
    expect(result.content.length).toBeGreaterThanOrEqual(2);
  });

  it("should filter identities by provider", async ({ expect }) => {
    const { identityService, userService, controller } = await setup();

    const user = await userService.users().create({
      username: "providerfilteruser",
      email: "providerfilter@example.com",
      roles: ["user"],
    });

    await identityService.identities().create({
      userId: user.id,
      provider: "google",
      providerUserId: "google-1",
    });
    await identityService.identities().create({
      userId: user.id,
      provider: "github",
      providerUserId: "github-1",
    });
    await identityService.identities().create({
      userId: user.id,
      provider: "google",
      providerUserId: "google-2",
    });

    const result = await controller.findIdentities(
      {
        query: { provider: "%google%" },
      },
      { user: adminUser },
    );

    expect(result.content.every((i) => i.provider === "google")).toBe(true);
    expect(result.content.length).toBeGreaterThanOrEqual(2);
  });

  it("should sort identities by creation date (newest first)", async ({
    expect,
  }) => {
    const { identityService, userService, controller } = await setup();

    const user = await userService.users().create({
      username: "sortidentityuser",
      email: "sortidentity@example.com",
      roles: ["user"],
    });

    // One `createdAt` for all three, which back-to-back inserts get often
    // enough (a millisecond stamp) to have failed CI: the order must not rest
    // on `createdAt` alone (#Q3732).
    const createdAt = "2026-01-01T00:00:00.000Z";

    const identity1 = await identityService.identities().create({
      userId: user.id,
      provider: "google",
      providerUserId: "google-sort-1",
      createdAt,
    });
    const identity2 = await identityService.identities().create({
      userId: user.id,
      provider: "github",
      providerUserId: "github-sort-1",
      createdAt,
    });
    const identity3 = await identityService.identities().create({
      userId: user.id,
      provider: "apple",
      providerUserId: "apple-sort-1",
      createdAt,
    });

    const result = await controller.findIdentities(
      {
        query: { userId: user.id },
      },
      { user: adminUser },
    );

    const identityIds = result.content.map((i) => i.id);
    expect(identityIds.indexOf(identity3.id)).toBeLessThan(
      identityIds.indexOf(identity2.id),
    );
    expect(identityIds.indexOf(identity2.id)).toBeLessThan(
      identityIds.indexOf(identity1.id),
    );
  });

  it("should handle identities without provider data", async ({ expect }) => {
    const { identityService, userService, controller } = await setup();

    const user = await userService.users().create({
      username: "noproviderdatauser",
      email: "noproviderdata@example.com",
      roles: ["user"],
    });

    const identity = await identityService.identities().create({
      userId: user.id,
      provider: "custom",
      providerUserId: "custom-123",
    });

    const result = await controller.getIdentity(
      {
        params: { id: identity.id },
      },
      { user: adminUser },
    );

    expect(result.providerData).toEqual({});
  });
});
