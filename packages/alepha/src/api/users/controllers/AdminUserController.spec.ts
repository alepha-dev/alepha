import { Alepha } from "alepha";
import { DbEntityNotFoundError } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity, type UserAccountToken } from "alepha/security";
import { BadRequestError } from "alepha/server";
import { describe, it } from "vitest";
import { AdminUserController, AlephaApiUsers, UserService } from "../index.ts";

const adminUser: UserAccountToken = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Test Admin",
  roles: ["admin"],
};

const asAdmin = { user: adminUser };

const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error" },
  });

  alepha.with(AlephaOrmPostgres);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaSecurity);

  await alepha.start();

  return {
    alepha,
    userService: alepha.inject(UserService),
    controller: alepha.inject(AdminUserController),
  };
};

describe("alepha/api/users - AdminUserController CRUD", () => {
  it("should create a new user", async ({ expect }) => {
    const { controller } = await setup();

    const result = await controller.createUser(
      {
        body: {
          username: "newuser",
          email: "newuser@example.com",
          phoneNumber: "+1234567890",
          firstName: "New",
          lastName: "User",
          enabled: true,
        },
      },
      asAdmin,
    );

    expect(result.username).toBe("newuser");
    expect(result.email).toBe("newuser@example.com");
    expect(result.phoneNumber).toBe("+1234567890");
    expect(result.firstName).toBe("New");
    expect(result.lastName).toBe("User");
    expect(result.enabled).toBe(true);
    expect(result.emailVerified).toBe(false);
    expect(result.roles).toEqual(["user"]);
    expect(result.id).toBeDefined();
  });

  it("should create a user with custom roles", async ({ expect }) => {
    const { controller } = await setup();

    const result = await controller.createUser(
      {
        body: {
          username: "admin",
          email: "admin@example.com",
          roles: ["admin", "user"],
        },
      },
      { user: adminUser },
    );

    expect(result.username).toBe("admin");
    expect(result.email).toBe("admin@example.com");
    expect(result.roles).toEqual(["admin", "user"]);
  });

  it("should reject duplicate username", async ({ expect }) => {
    const { controller } = await setup();

    await controller.createUser(
      {
        body: {
          username: "duplicateuser",
          email: "duplicate@example.com",
        },
      },
      asAdmin,
    );

    await expect(
      controller.createUser(
        {
          body: {
            username: "duplicateuser",
            email: "duplicate2@example.com",
          },
        },
        asAdmin,
      ),
    ).rejects.toThrowError(BadRequestError);
  });

  it("should get a user by ID", async ({ expect }) => {
    const { controller } = await setup();

    const created = await controller.createUser(
      {
        body: {
          username: "getuser",
          email: "getuser@example.com",
          firstName: "Get",
          lastName: "User",
        },
      },
      asAdmin,
    );

    const result = await controller.getUser(
      { params: { id: created.id } },
      asAdmin,
    );

    expect(result.id).toBe(created.id);
    expect(result.username).toBe("getuser");
    expect(result.email).toBe("getuser@example.com");
    expect(result.firstName).toBe("Get");
    expect(result.lastName).toBe("User");
  });

  it("should throw error for non-existent user", async ({ expect }) => {
    const { controller } = await setup();

    await expect(
      controller.getUser(
        { params: { id: "550e8400-e29b-41d4-a716-446655440000" } },
        asAdmin,
      ),
    ).rejects.toThrowError(DbEntityNotFoundError);
  });

  it("should update a user", async ({ expect }) => {
    const { controller } = await setup();

    const created = await controller.createUser(
      {
        body: {
          username: "updateuser",
          email: "updateuser@example.com",
          firstName: "Original",
          lastName: "Name",
        },
      },
      asAdmin,
    );

    const result = await controller.updateUser(
      {
        params: { id: created.id },
        body: {
          firstName: "Updated",
          lastName: "User",
        },
      },
      asAdmin,
    );

    expect(result.id).toBe(created.id);
    expect(result.username).toBe("updateuser");
    expect(result.email).toBe("updateuser@example.com");
    expect(result.firstName).toBe("Updated");
    expect(result.lastName).toBe("User");
  });

  it("should update user roles", async ({ expect }) => {
    const { controller } = await setup();

    const created = await controller.createUser(
      {
        body: {
          username: "roleupdate",
          email: "roleupdate@example.com",
        },
      },
      asAdmin,
    );

    expect(created.roles).toEqual(["user"]);

    const result = await controller.updateUser(
      {
        params: { id: created.id },
        body: {
          roles: ["admin", "moderator"],
        },
      },
      asAdmin,
    );

    expect(result.roles).toEqual(["admin", "moderator"]);
  });

  it("should delete a user", async ({ expect }) => {
    const { controller } = await setup();

    const created = await controller.createUser(
      {
        body: {
          username: "deleteuser",
          email: "deleteuser@example.com",
        },
      },
      asAdmin,
    );

    const result = await controller.deleteUser(
      { params: { id: created.id } },
      asAdmin,
    );

    expect(result.ok).toBe(true);
    expect(result.id).toBe(created.id);

    // Verify user is deleted
    await expect(
      controller.getUser({ params: { id: created.id } }, asAdmin),
    ).rejects.toThrowError(DbEntityNotFoundError);
  });

  it("should find users with pagination", async ({ expect }) => {
    const { controller } = await setup();

    // Create multiple users
    const user1 = await controller.createUser(
      {
        body: {
          username: "user1",
          email: "user1@example.com",
          firstName: "User",
          lastName: "One",
        },
      },
      asAdmin,
    );
    const user2 = await controller.createUser(
      {
        body: {
          username: "user2",
          email: "user2@example.com",
          firstName: "User",
          lastName: "Two",
        },
      },
      asAdmin,
    );
    const user3 = await controller.createUser(
      {
        body: {
          username: "user3",
          email: "user3@example.com",
          firstName: "User",
          lastName: "Three",
        },
      },
      asAdmin,
    );

    const result = await controller.findUsers({ query: {} }, asAdmin);

    expect(result.content.length).toBeGreaterThanOrEqual(3);

    // Verify all created users are in the results
    const userIds = result.content.map((u) => u.id);
    expect(userIds).toContain(user1.id);
    expect(userIds).toContain(user2.id);
    expect(userIds).toContain(user3.id);
  });

  it("should filter users by email", async ({ expect }) => {
    const { controller } = await setup();

    await controller.createUser(
      { body: { username: "filter1", email: "filter1@example.com" } },
      asAdmin,
    );
    await controller.createUser(
      { body: { username: "filter2", email: "filter2@test.com" } },
      asAdmin,
    );

    const result = await controller.findUsers(
      { query: { email: "%example.com%" } },
      asAdmin,
    );

    expect(result.content.length).toBeGreaterThanOrEqual(1);
    expect(result.content.every((u) => u.email?.includes("example.com"))).toBe(
      true,
    );
  });

  it("should filter users by enabled status", async ({ expect }) => {
    const { controller } = await setup();

    await controller.createUser(
      {
        body: {
          username: "enableduser",
          email: "enabled@example.com",
          enabled: true,
        },
      },
      asAdmin,
    );
    await controller.createUser(
      {
        body: {
          username: "disableduser",
          email: "disabled@example.com",
          enabled: false,
        },
      },
      asAdmin,
    );

    const enabledResult = await controller.findUsers(
      { query: { enabled: true } },
      asAdmin,
    );

    expect(enabledResult.content.every((u) => u.enabled === true)).toBe(true);

    const disabledResult = await controller.findUsers(
      { query: { enabled: false } },
      asAdmin,
    );

    expect(disabledResult.content.every((u) => u.enabled === false)).toBe(true);
  });

  it("should filter users by email verification status", async ({ expect }) => {
    const { controller } = await setup();

    await controller.createUser(
      {
        body: {
          username: "verifieduser",
          email: "verified@example.com",
          emailVerified: true,
        },
      },
      asAdmin,
    );
    await controller.createUser(
      {
        body: {
          username: "unverifieduser",
          email: "unverified@example.com",
          emailVerified: false,
        },
      },
      asAdmin,
    );

    const verifiedResult = await controller.findUsers(
      { query: { emailVerified: true } },
      asAdmin,
    );

    expect(verifiedResult.content.every((u) => u.emailVerified === true)).toBe(
      true,
    );

    const unverifiedResult = await controller.findUsers(
      { query: { emailVerified: false } },
      asAdmin,
    );

    expect(
      unverifiedResult.content.every((u) => u.emailVerified === false),
    ).toBe(true);
  });

  it("should filter users by roles", async ({ expect }) => {
    const { controller } = await setup();

    await controller.createUser.run(
      {
        body: {
          username: "adminuser",
          email: "admin@example.com",
          roles: ["admin", "user"],
        },
      },
      asAdmin,
    );
    await controller.createUser(
      {
        body: {
          username: "regularuser",
          email: "regular@example.com",
          roles: ["user"],
        },
      },
      asAdmin,
    );

    const adminResult = await controller.findUsers(
      { query: { roles: ["admin"] } },
      asAdmin,
    );

    expect(adminResult.content.every((u) => u.roles.includes("admin"))).toBe(
      true,
    );
  });

  it("should sort users by creation date (newest first)", async ({
    expect,
  }) => {
    const { controller } = await setup();

    const user1 = await controller.createUser(
      { body: { username: "firstuser", email: "first@example.com" } },
      asAdmin,
    );
    const user2 = await controller.createUser(
      { body: { username: "seconduser", email: "second@example.com" } },
      asAdmin,
    );
    const user3 = await controller.createUser(
      { body: { username: "thirduser", email: "third@example.com" } },
      asAdmin,
    );

    const result = await controller.findUsers({ query: {} }, asAdmin);

    const userIds = result.content.map((u) => u.id);
    expect(userIds.indexOf(user3.id)).toBeLessThan(userIds.indexOf(user2.id));
    expect(userIds.indexOf(user2.id)).toBeLessThan(userIds.indexOf(user1.id));
  });
});
