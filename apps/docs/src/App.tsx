import { t } from "@alepha/core";
import { $page, NotFound } from "@alepha/react";
import { NotFoundError } from "@alepha/server";
import { data } from "../node_modules/data";
import Home from "./components/Home.tsx";
import Layout from "./components/Layout.tsx";
import Module from "./components/Module.tsx";

export class App {
	layout = $page({
		component: Layout,
		children: () => [this.home, this.m],
	});

	home = $page({
		path: "/",
		component: Home,
		static: true,
	});

	m = $page({
		path: "/m/:module",
		component: Module,
		schema: {
			params: t.object({
				module: t.string(),
			}),
		},
		static: {
			entries: data.map((it) => ({
				params: { module: it.name.replaceAll("@alepha/", "") },
			})),
		},
		resolve: ({ params }) => {
			for (const module of data) {
				if (module.name.replaceAll("@alepha/", "") === params.module) {
					return { data: module };
				}
			}
			throw new NotFoundError();
		},
	});
}
