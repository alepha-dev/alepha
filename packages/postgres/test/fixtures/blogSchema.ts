import { t } from "@alepha/core";
import { $repository, pg, table } from "../../src";

export const commentEntitySchema = t.object({
	id: pg.identityPrimaryKey(),
	postId: pg.ref(t.int(), () => posts.id),
	userId: pg.ref(t.int(), () => users.id),
	message: t.string(),
});

export const comments = table("comments", commentEntitySchema);

export const postEntitySchema = t.object({
	id: pg.identityPrimaryKey(),
	content: t.string(),
	userId: pg.ref(t.int(), () => users.id),
	comments: pg.many(comments, "postId"),
});

export const posts = table("posts", postEntitySchema);

export const userEntitySchema = t.object({
	id: pg.identityPrimaryKey(),
	name: t.string(),
	posts: pg.many(posts, "userId"),
	comments: pg.many(comments, "userId"),
});

export const users = table("users", userEntitySchema);

export class Blog {
	users = $repository(users);
	posts = $repository(posts);
	comments = $repository(comments);
}
