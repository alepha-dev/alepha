import { join } from "node:path";
import {
	$hook,
	$inject,
	Alepha,
	OPTIONS,
	type TObject,
	type TSchema,
	TypeGuard,
	isTypeFile,
	t,
} from "@alepha/core";
import { SecurityModule } from "@alepha/security";
import {
	ServerActionDescriptorProvider,
	type ServerRouteAction,
	ServerRouterProvider,
} from "@alepha/server";
import { ServerStaticProvider } from "@alepha/server-static";
import type { OpenAPIV3 } from "openapi-types";
import {
	$swagger,
	type SwaggerDescriptorOptions,
} from "./descriptors/$swagger.ts";

export class ServerSwaggerProvider {
	protected readonly serverActionProvider = $inject(
		ServerActionDescriptorProvider,
	);
	protected readonly serverStaticProvider = $inject(ServerStaticProvider);
	protected readonly serverRouterProvider = $inject(ServerRouterProvider);
	protected readonly alepha = $inject(Alepha);

	protected readonly configure = $hook({
		name: "configure",
		after: this.serverActionProvider,
		handler: async (alepha) => {
			const doc = alepha.getDescriptorValues($swagger)?.[0];
			if (!doc || doc.value[OPTIONS].disabled) {
				return;
			}

			const options = doc.value[OPTIONS];

			const json = this.configureOpenApi(options);

			if (options.rewrite) {
				options.rewrite(json);
			}

			doc.instance[doc.key].json = () => json;

			const prefix = options.prefix ?? "/docs";

			await this.configureSwaggerApi(prefix, json);

			if (options.ui !== false) {
				await this.configureSwaggerUi(prefix, options);
			}
		},
	});

	protected configureOpenApi(doc: SwaggerDescriptorOptions) {
		const openApi: OpenAPIV3.Document = {
			openapi: "3.0.0",
			info: doc.info,
			paths: {},
			components: {},
		};

		const hasSecurity = this.alepha.has(SecurityModule);
		if (hasSecurity && openApi.components) {
			openApi.components.securitySchemes = {
				bearerAuth: {
					type: "http",
					scheme: "bearer",
					bearerFormat: "JWT",
				},
			};
		}

		const excludeTags = doc.excludeTags ?? [];
		const schemas: Record<string, any> = {};
		const schema = (source: TSchema) => {
			if (source.title) {
				schemas[source.title] = source;
				return { $ref: `#/components/schemas/${source.title}` };
			}
			return source;
		};

		for (const route of this.serverActionProvider.getActions()) {
			if (!route.options.schema) {
				continue;
			}

			const response = this.getResponseSchema(route);
			if (!response) {
				continue;
			}

			if (excludeTags.includes(route.group)) {
				continue;
			}

			if (route.options.internal) {
				continue;
			}

			const operation: OpenAPIV3.OperationObject = {
				operationId: route.name,
				summary: route.options.summary,
				description: route.options.description,
				tags: [route.group],
				responses: {
					[response.status]: {
						description: "",
						content: response.type
							? {
									[response.type]: {
										schema: schema(response.schema),
									},
								}
							: undefined,
					},
				},
			};

			if (route.options.security !== false && hasSecurity) {
				operation.security = [{ bearerAuth: [] }];
			}

			if (TypeGuard.IsObject(route.options.schema.body)) {
				if (this.isBodyMultipart(route.options.schema.body)) {
					operation.requestBody = {
						required: true,
						content: {
							"multipart/form-data": {
								schema: route.options.schema.body,
							},
						},
					};
				} else {
					operation.requestBody = {
						required: true,
						content: {
							"application/json": {
								schema: schema(route.options.schema.body),
							},
						},
					};
				}
			}

			if (TypeGuard.IsObject(route.options.schema.query)) {
				operation.parameters ??= [];
				for (const [key, value] of Object.entries(
					route.options.schema.query.properties,
				)) {
					operation.parameters.push({
						name: key,
						in: "query",
						required: false,
						schema: schema(value),
					});
				}
			}

			if (TypeGuard.IsObject(route.options.schema.params)) {
				operation.parameters ??= [];
				for (const [key, value] of Object.entries(
					route.options.schema.params.properties,
				)) {
					operation.parameters.push({
						name: key,
						in: "path",
						required: true,
						schema: schema(value),
					});
				}
			}

			const url = this.replacePathParams(route.path);

			openApi.paths[url] = {
				...openApi.paths[url],
				[route.method.toLowerCase()]: operation,
			};
		}

		if (openApi.components) openApi.components.schemas = schemas;

		return JSON.parse(JSON.stringify(openApi));
	}

	public isBodyMultipart(schema: TObject): boolean {
		for (const key in schema.properties) {
			if (isTypeFile(schema.properties[key])) {
				return true;
			}
		}
		return false;
	}

	public replacePathParams(url: string) {
		return url.replace(/:\w+/g, (match) => {
			const paramName = match.slice(1);
			return `{${paramName}}`;
		});
	}

	public getResponseSchema(route: ServerRouteAction):
		| {
				type?: string;
				schema?: any;
				status: number;
		  }
		| undefined {
		const schema: any = route.options.schema?.response;
		if (!schema) {
			return {
				status: 204,
			};
		}

		if (TypeGuard.IsObject(schema) || TypeGuard.IsArray(schema)) {
			return {
				schema,
				status: 200,
				type: "application/json",
			};
		}

		if (TypeGuard.IsString(schema)) {
			return {
				schema,
				status: 200,
				type: "text/plain",
			};
		}

		if (isTypeFile(schema)) {
			return {
				schema,
				status: 200,
				type: "application/octet-stream",
			};
		}

		const status = Object.keys(schema)[0];
		if (TypeGuard.IsObject(schema[status]) || isTypeFile(schema[status])) {
			return {
				schema,
				type: TypeGuard.IsObject(schema[status])
					? "application/json"
					: "application/octet-stream",
				status: Number(status),
			};
		}
	}

	protected async configureSwaggerApi(
		prefix: string,
		json: OpenAPIV3.Document,
	) {
		await this.serverRouterProvider.route({
			method: "GET",
			path: `${prefix}/json`,
			schema: {
				response: t.json(),
			},
			handler: () => json,
		});
	}

	protected async configureSwaggerUi(
		prefix: string,
		options: SwaggerDescriptorOptions,
	) {
		const ui = typeof options.ui === "object" ? options.ui : {};
		const initializer = `
window.onload = function() {
	window.ui = SwaggerUIBundle({
		url: "/docs/json",
		dom_id: '#swagger-ui',
		deepLinking: true,
		presets: [
			SwaggerUIBundle.presets.apis,
			SwaggerUIStandalonePreset
		],
		plugins: [
			SwaggerUIBundle.plugins.DownloadUrl
		],
		layout: "BaseLayout"
	});

  document.body.style.backgroundColor = "#f2f2f2";

	const options = ${JSON.stringify(ui)};

	if (options.initOAuth) {
		ui.initOAuth(options.initOAuth);
	}
};
		`.trim();

		const root =
			ui.root ?? join(import.meta.filename, "../../assets/swagger-ui");

		await this.serverStaticProvider.serve({
			path: prefix,
			root,
		});

		await this.serverRouterProvider.route({
			method: "GET",
			path: `${prefix}/swagger-initializer.js`,
			handler: ({ reply }) => {
				reply.headers["content-type"] = "application/javascript; charset=utf-8";
				return initializer;
			},
		});
	}
}
