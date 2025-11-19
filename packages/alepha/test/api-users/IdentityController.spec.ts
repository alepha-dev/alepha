import { Alepha } from "alepha";
import { DbEntityNotFoundError } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { describe, it } from "vitest";
import {
  AlephaApiUsers,
  IdentityController,
  IdentityService,
  UserService,
} from "../../src/api-users/index.ts";

const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error" },
  });

  alepha.with(AlephaSecurity);
  alepha.with(AlephaApiUsers);

  await alepha.start();

  return {
    alepha,
    identityService: alepha.inject(IdentityService),
    userService: alepha.inject(UserService),
    controller: alepha.inject(IdentityController),
  };
};

describe("alepha/api-users - IdentityController", () => {
  it("should get an identity by ID", async ({ expect }) => {
    const { identityService, userService, controller } = await setup();

    // Create a test user
    const user = await userService.users().create({
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

    const result = await controller.getIdentity({
      params: { id: identity.id },
    });

    expect(result.id).toBe(identity.id);
    expect(result.userId).toBe(user.id);
    expect(result.provider).toBe("google");
    expect(result.providerUserId).toBe("google-123456");
    expect(result.providerData).toEqual({
      name: "Test User",
      picture: "https://example.com/photo.jpg",
    });
  });

  it("should throw error for non-existent identity", async ({ expect }) => {
    const { controller } = await setup();

    await expect(
      controller.getIdentity({
        params: { id: "550e8400-e29b-41d4-a716-446655440000" },
      }),
    ).rejects.toThrowError(DbEntityNotFoundError);
  });

  it("should delete an identity", async ({ expect }) => {
    const { identityService, userService, controller } = await setup();

    const user = await userService.users().create({
      email: "deleteidentity@example.com",
      roles: ["user"],
    });

    const identity = await identityService.identities().create({
      userId: user.id,
      provider: "github",
      providerUserId: "github-789",
    });

    const result = await controller.deleteIdentity({
      params: { id: identity.id },
    });

    expect(result.ok).toBe(true);
    expect(result.id).toBe(identity.id);

    // Verify identity is deleted
    await expect(
      controller.getIdentity({
        params: { id: identity.id },
      }),
    ).rejects.toThrowError(DbEntityNotFoundError);
  });

  it("should find identities with pagination", async ({ expect }) => {
    const { identityService, userService, controller } = await setup();

    const user = await userService.users().create({
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

    const result = await controller.findIdentities({
      query: { userId: user.id },
    });

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
      email: "user1identity@example.com",
      roles: ["user"],
    });
    const user2 = await userService.users().create({
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

    const result = await controller.findIdentities({
      query: { userId: user1.id },
    });

    expect(result.content.every((i) => i.userId === user1.id)).toBe(true);
    expect(result.content.length).toBeGreaterThanOrEqual(2);
  });

  it("should filter identities by provider", async ({ expect }) => {
    const { identityService, userService, controller } = await setup();

    const user = await userService.users().create({
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

    const result = await controller.findIdentities({
      query: { provider: "%google%" },
    });

    expect(result.content.every((i) => i.provider === "google")).toBe(true);
    expect(result.content.length).toBeGreaterThanOrEqual(2);
  });

  it("should sort identities by creation date (newest first)", async ({
    expect,
  }) => {
    const { identityService, userService, controller } = await setup();

    const user = await userService.users().create({
      email: "sortidentity@example.com",
      roles: ["user"],
    });

    const identity1 = await identityService.identities().create({
      userId: user.id,
      provider: "google",
      providerUserId: "google-sort-1",
    });
    const identity2 = await identityService.identities().create({
      userId: user.id,
      provider: "github",
      providerUserId: "github-sort-1",
    });
    const identity3 = await identityService.identities().create({
      userId: user.id,
      provider: "apple",
      providerUserId: "apple-sort-1",
    });

    const result = await controller.findIdentities({
      query: { userId: user.id },
    });

    const identityIds = result.content.map((i) => i.id);
    expect(identityIds.indexOf(identity3.id)).toBeLessThan(
      identityIds.indexOf(identity2.id),
    );
    expect(identityIds.indexOf(identity2.id)).toBeLessThan(
      identityIds.indexOf(identity1.id),
    );
  });

  it("should handle identities with provider data", async ({ expect }) => {
    const { identityService, userService, controller } = await setup();

    const user = await userService.users().create({
      email: "providerdata@example.com",
      roles: ["user"],
    });

    const googleIdentity = await identityService.identities().create({
      userId: user.id,
      provider: "google",
      providerUserId: "google-data-1",
      providerData: {
        email: "test@gmail.com",
        verified_email: true,
        name: "Test User",
        picture: "https://example.com/photo.jpg",
        locale: "en",
      },
    });

    const githubIdentity = await identityService.identities().create({
      userId: user.id,
      provider: "github",
      providerUserId: "github-data-1",
      providerData: {
        login: "testuser",
        avatar_url: "https://github.com/avatar.jpg",
        bio: "Software Developer",
      },
    });

    const googleResult = await controller.getIdentity({
      params: { id: googleIdentity.id },
    });
    expect(googleResult.providerData).toEqual({
      email: "test@gmail.com",
      verified_email: true,
      name: "Test User",
      picture: "https://example.com/photo.jpg",
      locale: "en",
    });

    const githubResult = await controller.getIdentity({
      params: { id: githubIdentity.id },
    });
    expect(githubResult.providerData).toEqual({
      login: "testuser",
      avatar_url: "https://github.com/avatar.jpg",
      bio: "Software Developer",
    });
  });

  it("should handle identities without provider data", async ({ expect }) => {
    const { identityService, userService, controller } = await setup();

    const user = await userService.users().create({
      email: "noproviderdata@example.com",
      roles: ["user"],
    });

    const identity = await identityService.identities().create({
      userId: user.id,
      provider: "custom",
      providerUserId: "custom-123",
    });

    const result = await controller.getIdentity({
      params: { id: identity.id },
    });

    expect(result.providerData).toBeUndefined();
  });

  it("should handle multiple providers for same user", async ({ expect }) => {
    const { identityService, userService, controller } = await setup();

    const user = await userService.users().create({
      email: "multiprovider@example.com",
      roles: ["user"],
    });

    await identityService.identities().create({
      userId: user.id,
      provider: "google",
      providerUserId: "google-multi-1",
    });
    await identityService.identities().create({
      userId: user.id,
      provider: "github",
      providerUserId: "github-multi-1",
    });
    await identityService.identities().create({
      userId: user.id,
      provider: "apple",
      providerUserId: "apple-multi-1",
    });

    const result = await controller.findIdentities({
      query: { userId: user.id },
    });

    expect(result.content.length).toBe(3);
    const providers = result.content.map((i) => i.provider).sort();
    expect(providers).toEqual(["apple", "github", "google"]);
  });
});
