import { t } from "@alepha/core";
import { $entity, pg } from "@alepha/postgres";

export const post = $entity({
	name: "post",
	schema: t.object({
		id: pg.primaryKey(),
		createdAt: pg.createdAt(),
		title: t.string(),
		slug: t.string(),
		content: t.string(),
	}),
});

export const user = $entity({
	name: "user",
	schema: t.object({
		id: pg.primaryKey(),
		createdAt: pg.createdAt(),
		name: t.string(),
		email: t.string(),
		picture: t.optional(t.string()),
	}),
});

export const comment = $entity({
	name: "comment",
	schema: t.object({
		id: pg.primaryKey(),
		createdAt: pg.createdAt(),
		postId: pg.references(t.int(), () => post.id),
		userId: pg.references(t.int(), () => user.id),
		content: t.string(),
	}),
});
