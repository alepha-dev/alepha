import { $inject, t } from "@alepha/core";
import { $action } from "@alepha/server";
import { post } from "../entities.ts";
import { Database } from "../providers/Database.ts";

export class PostController {
	db = $inject(Database);

	getLastPosts = $action({
		security: false,
		schema: {
			response: t.array(post.$schema),
		},
		cache: { minutes: 5 },
		handler: async () => {
			const posts = await this.db.posts.find({
				sort: { createdAt: "desc" },
				limit: 10,
			});

			return posts;
		},
	});

	getPostBySlug = $action({
		security: false,
		schema: {
			params: t.object({
				slug: t.string(),
			}),
			response: post.$schema,
		},
		cache: { minutes: 15 },
		handler: async ({ params }) => {
			const postBySlug = await this.db.posts.findOne({
				slug: { eq: params.slug },
			});

			if (!postBySlug) {
				throw new Error("Post not found");
			}

			return postBySlug;
		},
	});

	createPost = $action({
		secure: true,
		schema: {
			body: post.$insertSchema,
			response: post.$schema,
		},
		handler: async ({ body }) => {
			const newPost = await this.db.posts.create(body);
			this.getLastPosts.invalidate();
			return newPost;
		},
	});
}
