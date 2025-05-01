import { Alepha, ContainerLockedError } from "@alepha/core";
import { expect, test } from "vitest";
import type { Realm } from "../src";
import {
	InvalidPermissionError,
	JwtProvider,
	SecurityError,
	SecurityProvider,
} from "../src";

test("SecurityProvider#can - default", () => {
	const sec = Alepha.create().get(SecurityProvider);

	sec.createPermission("hey");
	sec.createRole({
		name: "user",
		permissions: [{ name: "hey" }],
	});

	expect(sec.can("user", "hey")).toEqual(true);
	expect(sec.can("user", "noop")).toEqual(false);

	expect(() => sec.can("noop", "hey")).toThrow(SecurityError);
});

test("SecurityProvider#permissions - duplicate", () => {
	const app = Alepha.create();
	const security = app.get(SecurityProvider);

	expect(security.getPermissions().length).toEqual(0);
	security.createPermission("something:else");
	expect(security.getPermissions().length).toEqual(1);
	security.createPermission("something:else");
	expect(security.getPermissions().length).toEqual(1);
});

test("SecurityProvider#permissions - invalid", () => {
	const app = Alepha.create();
	const security = app.get(SecurityProvider);
	const invalid = [
		"",
		":",
		":hello",
		"hello:",
		"hello:world:",
		"hello:world:hello",
		"@@@@@...@@@@",
		{ name: "" },
		{ name: "*/*zd" },
	];

	for (const permission of invalid) {
		expect(() => security.createPermission(permission)).toThrow(
			InvalidPermissionError,
		);
	}
});

test("SecurityProvider#permissions - user", () => {
	const app = Alepha.create();
	const sec = app.get(SecurityProvider);

	sec.createPermission("hello:hey");
	sec.createPermission("hello:ho");
	sec.createPermission("hi");

	const user = sec.createRole({
		name: "user",
		permissions: [{ name: "hello:hey" }],
	});

	sec.createRole({
		name: "dude",
		permissions: [{ name: "hi" }],
	});

	sec.createRole({
		name: "superuser",
		permissions: [{ name: "hello:*" }],
	});

	expect(sec.getPermissions().length).toEqual(3);

	expect(sec.getPermissions({ roles: ["admin"] })).toEqual([
		{ group: "hello", name: "hey" },
		{ group: "hello", name: "ho" },
		{ name: "hi" },
	]);

	expect(() => sec.getPermissions({ roles: ["xxx"] }).length).toThrow(Error);

	expect(sec.getPermissions({ roles: ["superuser"] }).length).toEqual(2);

	expect(sec.getPermissions({ roles: ["user"] })).toEqual([
		{ group: "hello", name: "hey" },
	]);

	expect(sec.getPermissions({ roles: ["dude"] })).toEqual([{ name: "hi" }]);

	expect(sec.getPermissions({ roles: [user] }).length).toEqual(1);

	expect(sec.getPermissions({ roles: [] }).length).toEqual(0);
});

test("SecurityProvider#can - group", async () => {
	const app = Alepha.create({
		env: {
			SERVER_SECURITY_ENABLED: true,
		},
	});

	const sec = app.get(SecurityProvider);

	const permission = sec.createPermission("hello:hey");

	expect(() => sec.createPermission("@@@@@...@@@@")).toThrow(
		InvalidPermissionError,
	);

	await app.start();

	expect(() => sec.createPermission("hello:*")).toThrow(ContainerLockedError);

	expect(permission.name).toEqual("hey");
	expect(permission.group).toEqual("hello");

	sec.createRole({
		name: "user",
		permissions: [{ name: sec.permissionToString(permission) }],
	});

	sec.createRole({
		name: "superuser",
		permissions: [{ name: "hello:*" }],
	});

	expect(sec.can("user", "hello:hey")).toEqual(true);
	expect(sec.can("superuser", "hello:hey")).toEqual(true);
	expect(sec.can("superuser", "hello:*")).toEqual(true);
	expect(sec.can("superuser", "*")).toEqual(false);
	expect(sec.can("admin", "*")).toEqual(true);

	expect(sec.can("superuser", "wrong:hey")).toEqual(false);

	// Should this be false? It's not a valid permission
	expect(sec.can("superuser", "hello:ho")).toEqual(true);

	expect(sec.can("user", "noop")).toEqual(false);
});

test("SecurityProvider#checkPermission - ownership", async () => {
	const app = Alepha.create();
	const sec = app.get(SecurityProvider);

	const user = {
		name: "user",
		permissions: [{ name: "hello:hey", ownership: true }],
	};

	const superuser = {
		name: "superuser",
		permissions: [{ name: "hello:*" }],
	};

	sec.createPermission("hello:hey");
	sec.createRole(user);
	sec.createRole(superuser);

	expect(sec.checkPermission("hello:hey", user)).toEqual({
		ownership: true,
		isAuthorized: true,
	});

	expect(sec.checkPermission("hello:hey", user, superuser)).toEqual({
		ownership: false,
		isAuthorized: true,
	});

	expect(sec.checkPermission("hello:hey", superuser, user)).toEqual({
		ownership: false,
		isAuthorized: true,
	});

	expect(sec.checkPermission("hello:hey", superuser)).toEqual({
		ownership: false,
		isAuthorized: true,
	});
});

test("SecurityProvider#jwt - default", async () => {
	const app = Alepha.create();
	const jwt = app.get(JwtProvider);
	const sec = app.get(SecurityProvider);

	const userPermission = "hi";
	const userRole = {
		name: "user",
		permissions: [{ name: userPermission }],
	};

	sec.createPermission(userPermission);
	sec.createRole(userRole);

	await app.start(); // lock!

	const token = await jwt.create({
		sub: "123",
		roles: ["user"],
	});

	const user = await sec.createUserFromToken(token, userPermission);

	expect(user.id).toEqual("123");
	expect(user.roles).toEqual([userRole]);
	expect(user.token).toEqual(token);
	expect(user.realm).toEqual("default");
	expect(user.ownership).toEqual(false);

	await expect(() => sec.createUserFromToken(token, "noop")).rejects.toThrow(
		SecurityError,
	);

	await expect(() =>
		jwt.create(
			{
				sub: "123",
				roles: [],
			},
			"noop",
		),
	).rejects.toThrow(Error);

	const emptyToken = await jwt.create(
		{
			sub: "123",
			roles: [],
		},
		"default",
	);

	await expect(() =>
		sec.createUserFromToken(emptyToken, userPermission),
	).rejects.toThrow(SecurityError);
});

test("SecurityProvider#jwt - realms", async () => {
	const app = Alepha.create();
	const sec = app.get({
		provide: SecurityProvider,
		use: class extends SecurityProvider {
			createRealms(): Realm[] {
				return [
					{
						name: "customers",
						roles: [],
						secret: "********",
					},
					{
						name: "operators",
						roles: [],
						secret: "********",
					},
				];
			}
		},
	});

	sec.createPermission("customers:get");
	sec.createPermission("operators:get");

	sec.createRole(
		{
			name: "customer",
			permissions: [{ name: "customers:get", ownership: true }],
		},
		"customers",
	);

	expect(() =>
		sec.createRole({ name: "operator", permissions: [] }, "noop"),
	).toThrow(Error);

	sec.createRole(
		{
			name: "operator",
			permissions: [
				{ name: "customers:get" },
				{
					name: "operators:get",
				},
			],
		},
		"operators",
	);

	expect(sec.getRoles("customers").length).toEqual(1);
	expect(sec.getRoles("operators").length).toEqual(1);
	expect(sec.getRoles().length).toEqual(2);

	const userPermission = "hi";
	const userRole = {
		name: "user",
		permissions: [{ name: userPermission }],
	};

	sec.createPermission(userPermission);
	sec.createRole(userRole);

	expect(() =>
		sec.createRole(
			{ name: "operator", permissions: [{ name: "@@@invalid" }] },
			"operators",
		),
	).toThrow(Error);

	await app.start(); // lock!

	// add role with invalid permission => should throw
	expect(() =>
		sec.createRole(
			{ name: "operator", permissions: [{ name: "noop" }] },
			"operators",
		),
	).toThrow(Error);
});
