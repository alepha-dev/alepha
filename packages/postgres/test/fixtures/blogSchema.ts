import { t } from "@alepha/core";
import { $repository, pg, pgTableSchema } from "../../src";

export const commentEntitySchema = t.object({
	id: pg.identityPrimaryKey(),
	postId: pg.ref(t.int(), () => posts.id),
	userId: pg.ref(t.int(), () => users.id),
	message: t.string(),
});

export const comments = pgTableSchema("comments", commentEntitySchema);

export const postEntitySchema = t.object({
	id: pg.identityPrimaryKey(),
	content: t.string(),
	userId: pg.ref(t.int(), () => users.id),
	comments: pg.many(comments, "postId"),
});

export const posts = pgTableSchema("posts", postEntitySchema);

export const userEntitySchema = t.object({
	id: pg.identityPrimaryKey(),
	name: t.string(),
	posts: pg.many(posts, "userId"),
	comments: pg.many(comments, "userId"),
});

export const users = pgTableSchema("users", userEntitySchema);

export class Blog {
	users = $repository(users);
	posts = $repository(posts);
	comments = $repository(comments);
}
