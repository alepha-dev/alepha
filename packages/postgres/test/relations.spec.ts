import type { Env } from "@alepha/core";
import { Alepha } from "@alepha/core";
import { expect, test } from "vitest";
import { PgError } from "../src/errors/PgError.ts";
import { Blog } from "./fixtures/blogSchema.ts";

const setup = async (env: Env = {}) => {
	const alepha = Alepha.create({ env });
	const app = alepha.inject(Blog);
	await alepha.start();

	const john = await app.users.create({
		name: "john",
	});

	const dave = await app.users.create({ name: "dave" });

	const post1 = await app.posts.create({ userId: john.id, content: "123" });

	await app.posts.create({ userId: john.id, content: "456" });

	await app.posts.create({ userId: dave.id, content: "789" });

	await app.comments.create({
		postId: post1.id,
		message: "Hello",
		userId: dave.id,
	});

	await app.comments.create({
		postId: post1.id,
		message: "World",
		userId: dave.id,
	});

	return { app, john, dave };
};

test("relations - basic", async () => {
	const { app, john } = await setup();

	const list = await app.users.find({
		relations: {
			posts: {
				relations: {
					comments: {},
				},
			},
		},
	});

	expect(list).toEqual([
		{
			id: 1,
			name: "john",
			posts: [
				{
					id: 1,
					userId: 1,
					content: "123",
					comments: [
						{
							id: 1,
							postId: 1,
							message: "Hello",
							userId: 2,
						},
						{
							id: 2,
							postId: 1,
							message: "World",
							userId: 2,
						},
					],
				},
				{
					id: 2,
					userId: 1,
					content: "456",
				},
			],
		},
		{
			id: 2,
			name: "dave",
			posts: [
				{
					id: 3,
					userId: 2,
					content: "789",
				},
			],
		},
	]);

	await expect(() => app.users.deleteById(john.id)).rejects.toThrow(PgError);
});

test("relations - where", async () => {
	const { app } = await setup();

	expect(
		await app.users.find({
			where: {
				name: { eq: "dave" },
				posts: {
					content: { eq: "789" },
				},
			},
		}),
	).toEqual([
		{
			id: 2,
			name: "dave",
		},
	]);
});
