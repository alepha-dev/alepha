import { $hook, $inject, t } from "@alepha/core";
import { $page } from "@alepha/react";
import { ReactAuth } from "@alepha/react-auth";
import { isHttpError } from "@alepha/server";
import { $client, LinkProvider } from "@alepha/server-links";
import { createElement } from "react";
import NotFound from "./components/layout/NotFound.tsx";
import type { PostController } from "./controllers/PostController.ts";

export class Blog {
	posts = $client<PostController>();
	client = $inject(LinkProvider);
	auth = $inject(ReactAuth);

	blank = $page({
		path: "/blank",
		component: () => createElement("div", null, "Blank Page"),
	});

	onReady = $hook({
		name: "ready",
		handler: async () => {
			if (this.auth.user) {
				await this.client.getLinks();
			}
		},
	});

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
		client: true,
		resolve: async ({ params }) => {
			return {
				post: await this.posts.getPostBySlug({ params }),
			};
		},
		lazy: () => import("./components/ViewPost"),
	});

	root = $page({
		head: {
			title: "Alepha Blog",
		},
		lazy: () => import("./components/layout/Layout.tsx"),
		children: [this.home, this.newPost, this.viewPost],
		errorHandler: (error) => {
			if (isHttpError(error) && error.status === 404) {
				return createElement(NotFound);
			}
		},
	});
}
