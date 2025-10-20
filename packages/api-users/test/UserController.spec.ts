import { Alepha } from "@alepha/core";
import { PgEntityNotFoundError } from "@alepha/postgres";
import { AlephaSecurity } from "@alepha/security";
import { BadRequestError } from "@alepha/server";
import { describe, it } from "vitest";
import { AlephaApiUsers, UserController, UserService } from "../src/index.ts";

const setup = async () => {
	const alepha = Alepha.create({
		env: { LOG_LEVEL: "error" },
	});

	alepha.with(AlephaSecurity);
	alepha.with(AlephaApiUsers);

	await alepha.start();

	return {
		alepha,
		userService: alepha.inject(UserService),
		controller: alepha.inject(UserController),
	};
};

describe("@alepha/api-users - UserController CRUD", () => {
	it("should create a new user", async ({ expect }) => {
		const { controller } = await setup();

		const result = await controller.createUser({
			body: {
				email: "newuser@example.com",
				name: "New User",
				firstName: "New",
				lastName: "User",
				enabled: true,
			},
		});

		expect(result.email).toBe("newuser@example.com");
		expect(result.name).toBe("New User");
		expect(result.firstName).toBe("New");
		expect(result.lastName).toBe("User");
		expect(result.enabled).toBe(true);
		expect(result.emailVerified).toBe(false);
		expect(result.roles).toEqual(["user"]);
		expect(result.id).toBeDefined();
	});

	it("should create a user with custom roles", async ({ expect }) => {
		const { controller } = await setup();

		const result = await controller.createUser({
			body: {
				email: "admin@example.com",
				roles: ["admin", "user"],
			},
		});

		expect(result.email).toBe("admin@example.com");
		expect(result.roles).toEqual(["admin", "user"]);
	});

	it("should reject duplicate email", async ({ expect }) => {
		const { controller } = await setup();

		await controller.createUser({
			body: {
				email: "duplicate@example.com",
			},
		});

		await expect(
			controller.createUser({
				body: {
					email: "duplicate@example.com",
				},
			}),
		).rejects.toThrowError(BadRequestError);
	});

	it("should get a user by ID", async ({ expect }) => {
		const { controller } = await setup();

		const created = await controller.createUser({
			body: {
				email: "getuser@example.com",
				name: "Get User",
			},
		});

		const result = await controller.getUser({
			params: { id: created.id },
		});

		expect(result.id).toBe(created.id);
		expect(result.email).toBe("getuser@example.com");
		expect(result.name).toBe("Get User");
	});

	it("should throw error for non-existent user", async ({ expect }) => {
		const { controller } = await setup();

		await expect(
			controller.getUser({
				params: { id: "550e8400-e29b-41d4-a716-446655440000" },
			}),
		).rejects.toThrowError(PgEntityNotFoundError);
	});

	it("should update a user", async ({ expect }) => {
		const { controller } = await setup();

		const created = await controller.createUser({
			body: {
				email: "updateuser@example.com",
				name: "Original Name",
			},
		});

		const result = await controller.updateUser({
			params: { id: created.id },
			body: {
				name: "Updated Name",
				firstName: "Updated",
				lastName: "User",
			},
		});

		expect(result.id).toBe(created.id);
		expect(result.email).toBe("updateuser@example.com");
		expect(result.name).toBe("Updated Name");
		expect(result.firstName).toBe("Updated");
		expect(result.lastName).toBe("User");
	});

	it("should update user roles", async ({ expect }) => {
		const { controller } = await setup();

		const created = await controller.createUser({
			body: {
				email: "roleupdate@example.com",
			},
		});

		expect(created.roles).toEqual(["user"]);

		const result = await controller.updateUser({
			params: { id: created.id },
			body: {
				roles: ["admin", "moderator"],
			},
		});

		expect(result.roles).toEqual(["admin", "moderator"]);
	});

	it("should delete a user", async ({ expect }) => {
		const { controller } = await setup();

		const created = await controller.createUser({
			body: {
				email: "deleteuser@example.com",
			},
		});

		const result = await controller.deleteUser({
			params: { id: created.id },
		});

		expect(result.ok).toBe(true);
		expect(result.id).toBe(created.id);

		// Verify user is deleted
		await expect(
			controller.getUser({
				params: { id: created.id },
			}),
		).rejects.toThrowError(PgEntityNotFoundError);
	});

	it("should find users with pagination", async ({ expect }) => {
		const { controller } = await setup();

		// Create multiple users
		const user1 = await controller.createUser({
			body: { email: "user1@example.com", name: "User 1" },
		});
		const user2 = await controller.createUser({
			body: { email: "user2@example.com", name: "User 2" },
		});
		const user3 = await controller.createUser({
			body: { email: "user3@example.com", name: "User 3" },
		});

		const result = await controller.findUsers({
			query: {},
		});

		expect(result.content.length).toBeGreaterThanOrEqual(3);

		// Verify all created users are in the results
		const userIds = result.content.map((u) => u.id);
		expect(userIds).toContain(user1.id);
		expect(userIds).toContain(user2.id);
		expect(userIds).toContain(user3.id);
	});

	it("should filter users by email", async ({ expect }) => {
		const { controller } = await setup();

		await controller.createUser({
			body: { email: "filter1@example.com" },
		});
		await controller.createUser({
			body: { email: "filter2@test.com" },
		});

		const result = await controller.findUsers({
			query: { email: "%example.com%" },
		});

		expect(result.content.length).toBeGreaterThanOrEqual(1);
		expect(result.content.every((u) => u.email.includes("example.com"))).toBe(
			true,
		);
	});

	it("should filter users by enabled status", async ({ expect }) => {
		const { controller } = await setup();

		await controller.createUser({
			body: { email: "enabled@example.com", enabled: true },
		});
		await controller.createUser({
			body: { email: "disabled@example.com", enabled: false },
		});

		const enabledResult = await controller.findUsers({
			query: { enabled: true },
		});

		expect(enabledResult.content.every((u) => u.enabled === true)).toBe(true);

		const disabledResult = await controller.findUsers({
			query: { enabled: false },
		});

		expect(disabledResult.content.every((u) => u.enabled === false)).toBe(true);
	});

	it("should filter users by email verification status", async ({ expect }) => {
		const { controller } = await setup();

		await controller.createUser({
			body: { email: "verified@example.com", emailVerified: true },
		});
		await controller.createUser({
			body: { email: "unverified@example.com", emailVerified: false },
		});

		const verifiedResult = await controller.findUsers({
			query: { emailVerified: true },
		});

		expect(verifiedResult.content.every((u) => u.emailVerified === true)).toBe(
			true,
		);

		const unverifiedResult = await controller.findUsers({
			query: { emailVerified: false },
		});

		expect(
			unverifiedResult.content.every((u) => u.emailVerified === false),
		).toBe(true);
	});

	it("should filter users by roles", async ({ expect }) => {
		const { controller } = await setup();

		await controller.createUser({
			body: { email: "admin@example.com", roles: ["admin", "user"] },
		});
		await controller.createUser({
			body: { email: "regular@example.com", roles: ["user"] },
		});

		const adminResult = await controller.findUsers({
			query: { roles: ["admin"] },
		});

		expect(adminResult.content.every((u) => u.roles.includes("admin"))).toBe(
			true,
		);
	});

	it("should sort users by creation date (newest first)", async ({
		expect,
	}) => {
		const { controller } = await setup();

		const user1 = await controller.createUser({
			body: { email: "first@example.com" },
		});
		const user2 = await controller.createUser({
			body: { email: "second@example.com" },
		});
		const user3 = await controller.createUser({
			body: { email: "third@example.com" },
		});

		const result = await controller.findUsers({
			query: {},
		});

		const userIds = result.content.map((u) => u.id);
		expect(userIds.indexOf(user3.id)).toBeLessThan(userIds.indexOf(user2.id));
		expect(userIds.indexOf(user2.id)).toBeLessThan(userIds.indexOf(user1.id));
	});
});
