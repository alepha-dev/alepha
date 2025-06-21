import { t } from "@alepha/core";
import { $page, ClientOnly, Link, NestedView } from "@alepha/react";

export class App {
	hello = $page({
		component: () => {
			return (
				<div>
					<h1>Hello Alepha!</h1>
				</div>
			);
		},
	});

	test = $page({
		head: {
			title: "Test Page",
		},
		path: "/test",
		component: () => {
			return (
				<div>
					<h1>Test Page</h1>
					<Link to={"/sub/test"}>Sub Test</Link>
					<ClientOnly>
						<p>This content is only visible on the client side.</p>
					</ClientOnly>
				</div>
			);
		},
	});

	sub = $page({
		head: {
			title: "Sub Test Page",
		},
		path: "/sub/test",
		component: () => {
			return (
				<div>
					<h1>Sub Test Page</h1>
					<Link to={"/"}>Home</Link>
				</div>
			);
		},
	});

	params = $page({
		path: "/p/:name",
		schema: {
			params: t.object({
				name: t.string(),
			}),
		},
		resolve: ({ params }) => params,
		head: ({ name }) => ({
			title: `Params ${name} Page`,
		}),
		prerender: {
			entries: [
				{ params: { name: "z" } },
				{ params: { name: "example" } },
				{ params: { name: "demo" } },
			],
		},
		component: ({ name }) => {
			return (
				<div>
					<h1>Params {name} Page</h1>
					<Link to={"/"}>Home</Link>
				</div>
			);
		},
	});

	layout = $page({
		head: {
			title: "Layout Page",
			titleSeparator: " - ",
		},
		children: [this.params, this.hello, this.test, this.sub],
		component: () => {
			return (
				<div>
					<h1>Layout</h1>
					<nav>
						<Link to={"/"}>Home</Link>
						<Link to={"/test"}>Test</Link>
						<Link to={"/sub/test"}>Sub Test</Link>
						<Link to={"/p/z"}>Params Z</Link>
					</nav>
					<NestedView />
				</div>
			);
		},
	});
}
