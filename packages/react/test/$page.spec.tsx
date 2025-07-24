import { Alepha, t } from "@alepha/core";
import { test } from "vitest";
import { $page } from "../src";

class App {
	root = $page({
		component: () => "root",
	});

	home = $page({
		path: "/",
		component: () => "home",
	});

	test = $page({
		path: "/test",
		component: () => <div>test</div>,
	});

	hello = $page({
		path: "/hello/:name",
		schema: {
			params: t.object({
				name: t.string({ default: "world" }),
			}),
		},
		resolve: ({ params }) => params,
		component: ({ name }) => `hello ${name}`,
	});
}

const app = Alepha.create().inject(App);

test("$page - Basic", async ({ expect }) => {
	expect(await app.root.render().then((it) => it.html)).toEqual("root");
	expect(await app.home.render().then((it) => it.html)).toEqual("home");
	expect(await app.test.render().then((it) => it.html)).toEqual(
		"<div>test</div>",
	);
	expect(await app.hello.render().then((it) => it.html)).toEqual("hello world");
	expect(
		await app.hello.render({ params: { name: "jack" } }).then((it) => it.html),
	).toEqual("hello jack");
});
