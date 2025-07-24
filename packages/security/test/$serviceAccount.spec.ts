import { Alepha } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { expect, test } from "vitest";
import { $serviceAccount } from "../src/descriptors/$serviceAccount.ts";

class App {
	oauth2 = $serviceAccount({
		oauth2: {
			url: "https://example.com/oauth2/token",
			clientId: "your-client-id",
			clientSecret: "your-client-secret",
		},
	});

	signOptions = {
		expiresIn: 300, // 5 minutes
	};

	jwt = $serviceAccount({
		jwt: {
			secret: "your-jwt-secret",
			signOptions: this.signOptions,
		},
	});
}

const alepha = Alepha.create();
const app = alepha.inject(App);
const time = alepha.inject(DateTimeProvider);

test("$serviceAccount - jwt", async () => {
	const tk = await app.jwt.token();
	const parts = tk.split(".");
	expect(parts.length).toBe(3);
	const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));
	expect(payload).toEqual({
		sub: expect.any(String),
		roles: [],
		iat: expect.any(Number),
		exp: expect.any(Number),
	});

	app.signOptions.expiresIn += 1; // ensure token won't be the same
	const tk2 = await app.jwt.token();
	expect(tk2).toBe(tk); // should return the same token if not expired

	await time.travel([6, "minutes"]);

	app.signOptions.expiresIn += 1; // ensure token won't be the same
	const tk3 = await app.jwt.token();
	expect(tk3).not.toBe(tk); // should return a new token after expiration
});
