import { randomUUID } from "node:crypto";
import { Alepha } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { describe, test } from "vitest";
import { $realm } from "../src";

describe("$realm", () => {
	const roles = [
		{
			name: "admin",
			permissions: [{ name: "*" }],
		},
		{
			name: "user",
			permissions: [{ name: "read" }],
		},
	];

	test("should create token (access & refresh)", async ({ expect }) => {
		class App {
			realm = $realm({
				secret: "test",
				roles,
			});
		}

		const alepha = Alepha.create();
		const app = alepha.inject(App);
		const user = {
			id: randomUUID(),
			name: "Test User",
			roles: ["admin", "user"],
		};

		const dt = alepha.inject(DateTimeProvider);
		await alepha.start();

		const now = dt.pause();

		const token = await app.realm.createToken(user);

		expect(token).toEqual({
			access_token: expect.any(String),
			expires_in: app.realm.accessTokenExpiration.asSeconds(),
			refresh_token: expect.any(String),
			token_type: "Bearer",
			issued_at: now.unix(),
			refresh_token_expires_in: app.realm.refreshTokenExpiration.asSeconds(),
		});

		expect(
			JSON.parse(
				Buffer.from(token.access_token.split(".")[1], "base64").toString(),
			),
		).toEqual({
			sub: user.id,
			aud: app.realm.name,
			iat: now.unix(),
			exp: now.unix() + app.realm.accessTokenExpiration.asSeconds(),
			name: user.name,
			roles: ["admin", "user"],
		});

		expect(
			JSON.parse(
				Buffer.from(
					token.refresh_token?.split(".")?.[1] || "",
					"base64",
				).toString(),
			),
		).toEqual({
			sub: user.id,
			aud: app.realm.name,
			iat: now.unix(),
			exp: now.unix() + app.realm.refreshTokenExpiration.asSeconds(),
			typ: "refresh",
		});

		const newToken = await app.realm.createToken(user, token.refresh_token);
		expect(newToken).toEqual({
			access_token: expect.any(String),
			issued_at: now.unix(),
			expires_in: dt.duration(15, "minutes").asSeconds(),
			refresh_token: token.refresh_token,
			refresh_token_expires_in: dt.duration(30, "days").asSeconds(),
			token_type: "Bearer",
		});
	});
});
