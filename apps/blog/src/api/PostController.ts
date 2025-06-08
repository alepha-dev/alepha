import { $inject, t } from "@alepha/core";
import { $action } from "@alepha/server";
import { Db } from "../config/Db.ts";
import { post } from "../entities.ts";

export class PostController {
	db = $inject(Db);

	getLastPosts = $action({
		schema: {
			response: t.array(post.$schema),
		},
		handler: async () => {
			const posts = await this.db.posts.find({
				sort: { createdAt: "desc" },
				limit: 10,
			});

			return posts;
		},
	});

	createPost = $action({
		schema: {
			body: post.$insertSchema,
			response: post.$schema,
		},
		handler: async ({ body }) => {
			const newPost = await this.db.posts.create(body);
			return newPost;
		},
	});
}
