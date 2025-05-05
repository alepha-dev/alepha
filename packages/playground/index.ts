import { run, t } from "@alepha/core";
import { $action, $serve, $swagger } from "@alepha/server";

class App {
	serve = $serve({
		path: "/zug",
	});

	notFound = $action({
		path: "/zug/*",
		schema: {
			response: t.array(t.string()),
		},
		handler: ({}) => {
			return this.serve.list();
		},
	});

	docs = $swagger({
		info: {
			title: "Hello world",
			version: "1.0.0",
			description: "Hello world API",
		},
	});

	// realm = $realm({
	// 	secret: "azdaoazdazldknazldknazldza",
	// 	roles: [
	// 		{
	// 			name: "admin",
	// 			permissions: [
	// 				{
	// 					name: "*",
	// 				},
	// 			],
	// 		},
	// 	],
	// });

	d = $action({
		path: "/docs",
		security: false,
		schema: {
			response: t.any(),
		},
		handler: ({ headers }) => {
			headers["Content-Type"] = "application/json";
			return this.docs.json();
		},
	});

	hello = $action({
		method: "GET",
		path: "/hello/:name",
		schema: {
			params: t.object({
				name: t.string(),
			}),
			query: t.object({
				value: t.optional(t.int()),
			}),
			response: t.object({
				value: t.optional(t.int()),
				name: t.string(),
			}),
		},
		handler: async ({ query, params }) => {
			return {
				value: query.value,
				name: params.name,
			};
		},
	});

	helloByName = $action({
		method: "PUT",
		path: "/hello/:name",
		schema: {
			params: t.object({
				name: t.string(),
			}),
			query: t.object({
				value: t.optional(t.int()),
			}),
			body: t.object({
				message: t.string(),
			}),
			response: t.object({
				message: t.string(),
				value: t.optional(t.int()),
				name: t.string(),
			}),
		},
		handler: async ({ body, query, params }) => {
			return {
				message: body.message,
				value: query.value,
				name: params.name,
			};
		},
	});

	upload = $action({
		schema: {
			body: t.object({
				hello: t.file(),
				text: t.optional(t.string()),
				json: t.optional(
					t.object({
						hello: t.string(),
						world: t.string(),
					}),
				),
			}),
			response: t.object({
				name: t.string(),
				size: t.number(),
				type: t.string(),
			}),
		},
		handler: async ({ body }) => {
			return {
				name: body.hello.name,
				size: body.hello.size,
				type: body.hello.type,
			};
		},
	});

	download = $action({
		schema: {
			response: t.file(),
		},
		handler: async () => {
			return new File(["Hello world"], "hello.txt");
		},
	});

	login = $action({
		method: "POST",
		path: "/login",
		security: false,
		schema: {
			body: t.object({
				username: t.string(),
				password: t.string(),
			}),
			response: t.object({
				token: t.string(),
			}),
		},
		handler: async ({ reply }) => {
			return {
				token: "",
				//token: await this.realm.createToken(body.username, ["admin"]),
			};
		},
	});
}

run(App, {
	env: {
		LOG_LEVEL: "debug",
	},
});
