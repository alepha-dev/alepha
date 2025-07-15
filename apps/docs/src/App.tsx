import { t } from "@alepha/core";
import { $page } from "@alepha/react";
import { NotFoundError } from "@alepha/server";
import Content from "./components/Content.tsx";
import Home from "./components/Home.tsx";
import Layout from "./components/Layout.tsx";
import { docs } from "./config/docs.ts";

export class App {
	layout = $page({
		component: Layout,
		children: () => [this.home, this.m],
		head: {
			title: "Alepha",
			titleSeparator: " | ",
		},
	});

	home = $page({
		path: "/",
		component: Home,
		static: true,
	});

	m = $page({
		path: "/docs/:slug",
		component: Content,
		schema: {
			params: t.object({
				slug: t.string(),
			}),
		},
		static: {
			entries: docs.map((it) => ({
				params: { slug: it.slug },
			})),
		},
		resolve: async ({ params }) => {
			for (const pkg of docs) {
				if (pkg.slug === params.slug) {
					return { ...pkg, content: await pkg.content() };
				}
			}
			throw new NotFoundError();
		},
		head: ({ name }) => {
			return {
				title: name,
			};
		},
	});
}
