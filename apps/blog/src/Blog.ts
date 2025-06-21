import { t } from "@alepha/core";
import { $page } from "@alepha/react";
import { $client, isHttpError } from "@alepha/server";
import { createElement } from "react";
import NotFound from "./components/layout/NotFound.tsx";
import type { PostController } from "./controllers/PostController.ts";

export class Blog {
	posts = $client<PostController>();

	home = $page({
		path: "/",
		head: {
			title: "Home",
		},
		lazy: () => import("./components/Home"),
		cache: true,
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
			return {
				post: await this.posts.getPostBySlug({ params }),
			};
		},
		lazy: () => import("./components/ViewPost"),
	});

	notFound = $page({
		path: "/*",
		head: {
			title: "Not Found",
		},
		lazy: () => import("./components/layout/NotFound.tsx"),
	});

	root = $page({
		head: {
			title: "Alepha Blog",
		},
		lazy: () => import("./components/layout/Layout.tsx"),
		children: [this.home, this.newPost, this.viewPost, this.notFound],
		errorHandler: (error) => {
			if (isHttpError(error) && error.status === 404) {
				return createElement(NotFound);
			}
		},
	});
}
