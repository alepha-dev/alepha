import { describe, it } from "vitest";
import { RouterProvider } from "../src/providers/RouterProvider.ts";

interface TestRoute {
	name: string;
	path: string;
}

class TestRouterProvider extends RouterProvider<TestRoute> {
	public push(route: TestRoute) {
		super.push(route);
	}
}

const playground = () => {
	const router = new TestRouterProvider();
	const add = (path: string, name: string) => {
		router.push({
			path,
			name,
		});
	};

	const match = (path: string) => {
		const { route, params } = router.match(`${path}?a=b`);
		return {
			name: route?.name ?? "null",
			params: params,
		};
	};

	return {
		add,
		match,
		router,
	};
};

describe("RouterProvider", () => {
	it("should match routes with static paths, params, and wildcards", ({
		expect,
	}) => {
		const { add, match } = playground();

		add("/", "home");
		add("/about", "about");
		add("/dist/", "dist");
		add("/users", "users");
		add("/users/:name", "users-by-name");
		add("/users/:name/INFO", "users-by-name-info");
		add("/users/:name/x/y/z", "users-by-name-x-y-z");
		add("/useRs/:name/x/*", "users-by-name-x-not-found");
		add("/*", "not-found");

		expect(match("/")).toEqual({
			name: "home",
			params: {},
		});

		expect(match("/about")).toEqual({
			name: "about",
			params: {},
		});

		expect(match("/dist")).toEqual({
			name: "dist",
			params: {},
		});

		expect(match("/dist/")).toEqual({
			name: "dist",
			params: {},
		});

		expect(match("/users/jack")).toEqual({
			name: "users-by-name",
			params: {
				name: "jack",
			},
		});

		expect(match("/users/jack/info")).toEqual({
			name: "users-by-name-info",
			params: {
				name: "jack",
			},
		});

		expect(match("/users/jack/info/other")).toEqual({
			name: "not-found",
			params: {
				name: "jack",
			},
		});

		expect(match("/users/JACK/x")).toEqual({
			name: "users-by-name-x-not-found",
			params: {
				name: "JACK",
			},
		});

		expect(match("/users/jack/x/y")).toEqual({
			name: "users-by-name-x-not-found",
			params: {
				name: "jack",
			},
		});

		expect(match("/users/jack/x/y/z")).toEqual({
			name: "users-by-name-x-y-z",
			params: {
				name: "jack",
			},
		});

		expect(match("/users/jack/x/abc/def")).toEqual({
			name: "users-by-name-x-not-found",
			params: {
				"*": "abc/def",
				name: "jack",
			},
		});

		expect(match("/weird")).toEqual({
			name: "not-found",
			params: {
				"*": "weird",
			},
		});
	});

	it("should return null for paths with no matching routes", ({ expect }) => {
		const { match } = playground();
		expect(match("/")).toEqual({
			name: "null",
			params: {},
		});
		expect(match("/abc/def")).toEqual({
			name: "null",
			params: {},
		});
	});

	it("should throw error for invalid path formats", ({ expect }) => {
		const { match } = playground();
		expect(() => match("x")).toThrowError();
		expect(() => match("(*__*)")).toThrowError();
	});

	it("should match only wildcard route", ({ expect }) => {
		const { add, match } = playground();
		add("/*", "wildcard");
		expect(match("/")).toEqual({
			name: "wildcard",
			params: {
				"*": "",
			},
		});
	});

	it("should throw error when adding invalid path", ({ expect }) => {
		const { add } = playground();
		expect(() => add("*", "wildcard")).toThrowError();
	});

	it("should handle routes with params and wildcard", ({ expect }) => {
		const { add, match } = playground();
		add("/users/*", "users-not-found");
		add("/users/:name/x/*", "users-by-name-x-not-found");
		expect(match("/users/jack/x/y/z")).toEqual({
			name: "users-by-name-x-not-found",
			params: {
				name: "jack",
				"*": "y/z",
			},
		});
	});

	it("should handle routes with different param names", ({ expect }) => {
		const { add, match } = playground();
		add("/users/:id", "home");
		add("/users/:userId/hello", "hello");
		expect(match("/users/jack")).toEqual({
			name: "home",
			params: {
				id: "jack",
			},
		});
		expect(match("/users/jack/hello")).toEqual({
			name: "hello",
			params: {
				userId: "jack",
			},
		});
	});
});
