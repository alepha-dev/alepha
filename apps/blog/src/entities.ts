import { t } from "@alepha/core";
import { $entity, pg } from "@alepha/postgres";

export const post = $entity({
	name: "posts",
	schema: t.object({
		id: pg.primaryKey(t.bigint()),
		createdAt: pg.createdAt(),
		updatedAt: pg.updatedAt(),
		title: t.string(),
		slug: t.string(),
		content: t.string(),
		tags: t.optional(t.array(t.string())),
	}),
	indexes: [
		{
			column: "slug",
			unique: true,
		},
	],
});

export const user = $entity({
	name: "users",
	schema: t.object({
		id: pg.primaryKey(t.bigint()),
		createdAt: pg.createdAt(),
		updatedAt: pg.updatedAt(),
		name: t.string(),
		email: t.string(),
		picture: t.optional(t.string()),
	}),
	indexes: [
		{
			column: "email",
			unique: true,
		},
	],
});

export const comment = $entity({
	name: "comments",
	schema: t.object({
		id: pg.primaryKey(t.bigint()),
		createdAt: pg.createdAt(),
		updatedAt: pg.updatedAt(),
		postId: pg.ref(t.bigint(), () => post.id, {
			onDelete: "cascade",
		}),
		userId: pg.ref(t.bigint(), () => user.id, {
			onDelete: "cascade",
		}),
		content: t.string(),
	}),
	indexes: ["postId", "userId"],
});
