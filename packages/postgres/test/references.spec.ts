import { Alepha, t } from "@alepha/core";
import { expect, test } from "vitest";
import { $repository, pg, table } from "../src";

const users = table(
	"users",
	t.object({
		id: pg.identityPrimaryKey(),
		__v: pg.version(),
		name: t.string(),
		currentPostId: pg.ref(t.optional(t.int()), () => posts.id, {
			onDelete: "set null",
		}),
	}),
);

const posts = table(
	"posts",
	t.object({
		id: pg.identityPrimaryKey(),
		__v: pg.version(),
		userId: pg.ref(t.int(), () => users.id, {
			onDelete: "cascade",
		}),
		postParentId: pg.ref(t.optional(t.int()), () => posts.id, {
			onDelete: "cascade",
		}),
	}),
);

class App {
	users = $repository(users);
	posts = $repository(posts);
}

test("references - delete cascade", async () => {
	const alepha = Alepha.create();
	const app = alepha.get(App);
	await alepha.start();

	const user = await app.users.create({ name: "John" });
	const post1 = await app.posts.create({ userId: user.id });
	const post2 = await app.posts.create({
		userId: user.id,
		postParentId: post1.id,
	});

	expect(await app.users.find()).toEqual([
		{ id: user.id, name: "John", __v: 0 },
	]);
	expect(await app.posts.find()).toEqual([
		{ id: post1.id, userId: user.id, __v: 0 },
		{ id: post2.id, userId: user.id, postParentId: post1.id, __v: 0 },
	]);

	await app.users.deleteById(user.id);

	expect(await app.users.find()).toEqual([]);
	expect(await app.posts.find()).toEqual([]);
});

test("references - delete null", async () => {
	const alepha = Alepha.create();
	const app = alepha.get(App);
	await alepha.start();

	const user = await app.users.create({ name: "John" });
	const post1 = await app.posts.create({ userId: user.id });
	const post2 = await app.posts.create({
		userId: user.id,
		postParentId: post1.id,
	});
	const post3 = await app.posts.create({
		userId: user.id,
	});

	user.currentPostId = post2.id;

	await app.users.save(user);

	expect(await app.users.find()).toEqual([
		{ id: user.id, name: "John", __v: 1, currentPostId: post2.id },
	]);

	expect(await app.posts.find()).toEqual([
		{ id: post1.id, userId: user.id, __v: 0 },
		{ id: post2.id, userId: user.id, postParentId: post1.id, __v: 0 },
		{ id: post3.id, userId: user.id, __v: 0 },
	]);

	await app.posts.deleteById(post1.id);

	expect(await app.users.find()).toEqual([
		{ id: user.id, name: "John", __v: 1 },
	]);

	expect(await app.posts.find()).toEqual([
		{ id: post3.id, userId: user.id, __v: 0 },
	]);
});
