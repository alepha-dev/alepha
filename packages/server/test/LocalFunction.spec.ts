import { Alepha } from "@alepha/core";
import { $role } from "@alepha/security";
import { test } from "vitest";
import { $route as $action, ForbiddenError, UnauthorizedError } from "../src";

const alepha = Alepha.create({
	env: {
		SERVER_SECURITY_ENABLED: true,
	},
});

class App {
	admin = $role({
		permissions: [{ name: "*" }],
	});

	hey = $action({
		handler: ({ user }) => `Hey ${user.name}`,
	});

	hey2 = $action({
		security: true,
		handler: ({ user }) => `Hey ${user.name}`,
	});

	hey_unsecure = $action({
		security: false,
		handler: ({ user }) => `Hey ${user?.name}`,
	});
}

const app = alepha.get(App);

test("Security - Basic", async ({ expect }) => {
	// if omitted, the user is the system user
	expect(await app.hey()).toBe("Hey System");

	// if user key is defined but undefined, throw an error
	await expect(app.hey({}, { user: undefined })).rejects.toThrowError(
		UnauthorizedError,
	);

	await expect(
		app.hey({}, { user: { id: "1", token: "", realm: "", name: "John" } }),
	).rejects.toThrowError(ForbiddenError);

	await expect(
		app.hey({}, { user: { id: "1", name: "John", roles: [app.admin()] } }),
	).resolves.toBe("Hey John");
});

test("Security - Unsecure", async ({ expect }) => {
	expect(await app.hey_unsecure()).toBe("Hey System");

	expect(await app.hey_unsecure({}, { user: undefined })).toBe("Hey System");

	await expect(
		app.hey_unsecure(
			{},
			{ user: { id: "1", token: "", realm: "", name: "John" } },
		),
	).resolves.toBe("Hey John");
});
