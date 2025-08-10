import { randomUUID } from "node:crypto";
import { Alepha } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { $realm } from "@alepha/security";
import { $client } from "@alepha/server-links";
import { describe, test } from "vitest";
import { $auth, ReactAuth, ReactAuthProvider } from "../src";

describe("$auth", () => {
	describe("$auth", () => {
		const user = {
			id: randomUUID(),
			name: "John Doe",
			username: "john",
			password: "***",
			roles: ["admin"],
		};

		class App {
			realm = $realm({
				secret: "my-secret-key",
				roles: [
					{
						name: "admin",
						permissions: [{ name: "*" }],
					},
				],
			});

			auth = $auth({
				realm: this.realm,
				credentials: {
					user: () => user,
				},
			});

			api = $client<ReactAuthProvider>();
		}

		const userinfo = (auth: ReactAuthProvider, token?: string) =>
			auth.userinfo
				.fetch(
					{},
					{
						request: {
							headers: {
								authorization: `Bearer ${token}`,
							},
						},
					},
				)
				.then((it) => it.data);

		const login = (auth: ReactAuthProvider) =>
			auth.token.fetch({
				query: {
					provider: "auth",
				},
				body: {
					username: user.username,
					password: user.password,
				},
			});

		test("should login with credentials", async ({ expect }) => {
			const alepha = Alepha.create().with(App);
			const auth = alepha.inject(ReactAuth);
			await alepha.start();

			expect(auth.user).toBeUndefined();
			await auth.login("auth", user);
			expect(auth.user).toEqual({
				id: user.id,
				name: user.name,
				roles: user.roles,
			});
		});

		test("should get userinfo", async ({ expect }) => {
			const alepha = Alepha.create().with(App);
			await alepha.start();
			const auth = alepha.inject(ReactAuthProvider);

			const { data: tokens } = await login(auth);

			expect(await userinfo(auth, tokens.access_token)).toEqual({
				id: user.id,
				name: user.name,
				roles: user.roles,
			});
		});

		test("should reject expired token", async ({ expect }) => {
			const alepha = Alepha.create().with(App);
			await alepha.start();
			const auth = alepha.inject(ReactAuthProvider);

			const { data: tokens } = await login(auth);

			await alepha.inject(DateTimeProvider).travel(1, "hour");

			await expect(userinfo(auth, tokens.access_token)).rejects.toThrowError(
				"Token expired",
			);
		});

		test("should refresh expired token", async ({ expect }) => {
			const alepha = Alepha.create().with(App);
			await alepha.start();
			const auth = alepha.inject(ReactAuthProvider);

			const { data: tokens } = await login(auth);

			await alepha.inject(DateTimeProvider).travel(1, "hour");

			const { data: tokens2 } = await auth.refresh.fetch({
				query: {
					provider: "auth",
				},
				body: {
					refresh_token: tokens.refresh_token!,
					access_token: tokens.access_token,
				},
			});

			expect(await userinfo(auth, tokens2.access_token)).toEqual({
				id: user.id,
				name: user.name,
				roles: user.roles,
			});
		});

		test("should reject expired refresh token", async ({ expect }) => {
			const alepha = Alepha.create().with(App);
			await alepha.start();
			const auth = alepha.inject(ReactAuthProvider);

			const { data: tokens } = await login(auth);

			await alepha.inject(DateTimeProvider).travel(40, "days");

			await expect(
				auth.refresh.fetch({
					query: {
						provider: "auth",
					},
					body: {
						refresh_token: tokens.refresh_token!,
						access_token: tokens.access_token,
					},
				}),
			).rejects.toThrowError(
				"Failed to refresh access token using the refresh token (realm)",
			);
		});
	});
});
