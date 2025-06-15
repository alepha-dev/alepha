import { t } from "@alepha/core";
import { $page } from "@alepha/react";
import { $client } from "@alepha/server";
import type { PostController } from "./controllers/PostController.ts";

export class Blog {
	posts = $client<PostController>();

	home = $page({
		path: "/",
		head: {
			title: "Home",
		},
		lazy: () => import("./components/Home"),
		resolve: async () => {
			return {
				posts: await this.posts.getLastPosts(),
			};
		},
	});

	newPost = $page({
		path: "/new",
		can: () => this.posts.createPost.can(),
		lazy: () => import("./components/NewPost"),
	});

	viewPost = $page({
		path: "/post/:slug",
		schema: {
			params: t.object({
				slug: t.string(),
			}),
		},
		resolve: async ({ params }) => {
			const post = await this.posts.getPostBySlug({ params });
			if (!post) {
				throw new Error("Post not found");
			}
			return { post };
		},
		lazy: () => import("./components/ViewPost"),
	});

	root = $page({
		head: {
			title: "Alepha Blog",
		},
		lazy: () => import("./components/layout/Layout.tsx"),
		children: [this.home, this.newPost, this.viewPost],
	});
}
