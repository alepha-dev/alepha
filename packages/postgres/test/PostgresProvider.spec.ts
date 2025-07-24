import { Alepha } from "@alepha/core";
import { expect, test } from "vitest";
import { $repository } from "../src";
import { userEntity } from "./fixtures/userEntitySchema.ts";

test("PostgresProvider - basic", async () => {
	class UserService {
		users = $repository(userEntity);
	}

	const alepha = Alepha.create();

	const userService = alepha.inject(UserService);

	await alepha.start();

	await userService.users.create({
		name: "John",
		profile: {
			age: 30,
		},
	});

	const [r1] = await userService.users.find({
		where: { name: { eq: "John" } },
	});

	expect(r1.name).toEqual("John");
	expect(r1.createdAt).toBe(r1.updatedAt);

	await new Promise((resolve) => setTimeout(resolve, 1));

	const r2 = await userService.users.updateOne(
		{ name: { eq: "John" } },
		{
			profile: { age: 31 },
		},
	);

	expect(r2.name).toEqual("John");
	expect(r2.profile.age).toEqual(31);
	expect(r2.createdAt).toBe(r1.createdAt);
	expect(r2.updatedAt).not.toBe(r1.updatedAt);
});
