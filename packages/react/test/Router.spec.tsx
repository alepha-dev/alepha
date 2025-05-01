import { Alepha, t } from "@alepha/core";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { test } from "vitest";
import { NestedView, Router } from "../src";

const str = (r: { element: ReactNode }): string => {
	return renderToString(r.element).replaceAll("<!-- -->", "");
};

test("Router - Basic", async ({ expect }) => {
	const alepha = Alepha.create();
	const router = alepha.get(Router);

	router.add({
		name: "Test",
		path: "/",
		component: () => "Hey",
	});

	expect(str(await router.render("/"))).toEqual("Hey");
	expect(str(await router.render("/zz"))).toEqual("Not Found");
});

test("Router - NestedView", async ({ expect }) => {
	const alepha = Alepha.create();
	const router = alepha.get(Router);

	router.add({
		name: "Test",
		component: () => (
			<>
				((
				<NestedView />
				))
			</>
		),
		children: [
			{
				name: "Home",
				path: "/",
				component: () => "Home",
			},
			{
				name: "Hello",
				path: "/hello/:name",
				schema: {
					params: t.object({
						name: t.string(),
					}),
				},
				resolve: ({ params }) => params,
				component: (props) => `Hello, ${props.name}!`,
			},
		],
	});

	expect(str(await router.render("/"))).toEqual("((Home))");
	expect(str(await router.render("/hello/jack"))).toEqual("((Hello, jack!))");
});

test("Router - All routes", async ({ expect }) => {
	const alepha = Alepha.create();
	const router = alepha.get(Router);

	router.add({
		children: [
			{
				component: () => "home",
			},
			{
				path: "about",
				component: () => "about",
			},
			{
				path: "sub",
				children: [
					{
						component: () => "a",
					},
					{
						path: "b",
						component: () => "b",
					},
				],
			},
			{
				path: "users",
				component: () => <NestedView>yo</NestedView>,
				children: [
					{
						path: "new",
						component: () => "users/new",
					},
					{
						path: ":id",
						schema: { params: t.object({ id: t.string() }) },
						resolve: ({ params }) => {
							if (params.id === "boom") throw new Error("boom");
							return params;
						},
						children: [
							{
								resolve: ({ params }) => params,
								component: ({ id }) => `hey ${id}`,
							},
							{
								path: "profile",
								resolve: ({ params }) => params,
								component: ({ id }) => `profile of ${id}`,
							},
						],
					},
				],
				errorHandler: ({ error }) => {
					return `Error: ${error.message}`;
				},
			},
		],
		notFoundHandler: () => "404",
	});

	expect(str(await router.render("/"))).toEqual("home");
	expect(str(await router.render("/about"))).toEqual("about");
	expect(str(await router.render("/noop"))).toEqual("404");
	expect(str(await router.render("/noop/noop"))).toEqual("404");
	expect(str(await router.render("/sub"))).toEqual("a");
	expect(str(await router.render("/sub/"))).toEqual("a");
	expect(str(await router.render("/sub/b"))).toEqual("b");
	expect(str(await router.render("/sub/noop"))).toEqual("404");
	expect(str(await router.render("/users"))).toEqual("yo");
	expect(str(await router.render("/users/"))).toEqual("yo");
	expect(str(await router.render("/users/a"))).toEqual("hey a");
	expect(str(await router.render("/users/boom"))).toEqual("Error: boom");
	expect(str(await router.render("/users/new"))).toEqual("users/new");
	expect(str(await router.render("/users/hey/ho"))).toEqual("404");
	expect(str(await router.render("/users/a/profile"))).toEqual("profile of a");
});
