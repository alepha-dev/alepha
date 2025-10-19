import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	$hook,
	$inject,
	Alepha,
	isTypeFile,
	type TObject,
	type TSchema,
	t,
} from "@alepha/core";
import { $logger } from "@alepha/logger";
import { AlephaSecurity } from "@alepha/security";
import {
	$action,
	type ActionDescriptor,
	type RequestConfigSchema,
	ServerProvider,
	ServerRouterProvider,
} from "@alepha/server";
import { ServerStaticProvider } from "@alepha/server-static";
import type { OpenAPIV3 } from "openapi-types";
import {
	$swagger,
	type SwaggerDescriptorOptions,
} from "./descriptors/$swagger.ts";

export class ServerSwaggerProvider {
	protected readonly serverStaticProvider = $inject(ServerStaticProvider);
	protected readonly serverRouterProvider = $inject(ServerRouterProvider);
	protected readonly serverProvider = $inject(ServerProvider);
	protected readonly alepha = $inject(Alepha);
	protected readonly log = $logger();

	public json?: OpenAPIV3.Document;

	protected readonly configure = $hook({
		on: "configure",
		priority: "last",
		handler: async (alepha) => {
			const options = alepha.descriptors($swagger)?.[0]?.options ?? {
				info: {
					title: "API Documentation",
					version: "1.0.0",
				},
			};

			this.json = await this.createSwagger(options);
		},
	});

	public async createSwagger(
		options: SwaggerDescriptorOptions,
	): Promise<OpenAPIV3.Document | undefined> {
		if (options.disabled) {
			return;
		}

		const json = this.configureOpenApi(
			this.alepha.descriptors($action),
			options,
		);

		if (options.rewrite) {
			options.rewrite(json);
		}

		const prefix = options.prefix ?? "/docs";

		this.configureSwaggerApi(prefix, json);

		if (options.ui !== false) {
			await this.configureSwaggerUi(prefix, options);
		}

		return json;
	}

	protected configureOpenApi(
		actions: ActionDescriptor<RequestConfigSchema>[],
		doc: SwaggerDescriptorOptions,
	): OpenAPIV3.Document {
		const openApi: OpenAPIV3.Document = {
			openapi: "3.0.0",
			info: doc.info,
			paths: {},
			components: {},
		};

		const hasSecurity = this.alepha.has(AlephaSecurity);
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
			if ("title" in source && typeof source.title === "string") {
				schemas[source.title] = source;
				return { $ref: `#/components/schemas/${source.title}` };
			}
			return source;
		};

		const copy = (obj: any) => JSON.parse(JSON.stringify(obj));

		for (const route of actions) {
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

			if (route.options.hide) {
				continue;
			}

			const operation: OpenAPIV3.OperationObject = {
				operationId: route.name,
				summary: route.options.summary,
				description: route.options.description,
				tags: [route.group.replaceAll(":", " / ")],
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

			if (route.options.secure !== false && hasSecurity) {
				operation.security = [{ bearerAuth: [] }];
			}

			const g = t.raw;

			if (
				g.IsObject(route.options.schema.body) ||
				g.IsArray(route.options.schema.body)
			) {
				if (
					g.IsObject(route.options.schema.body) &&
					this.isBodyMultipart(route.options.schema.body)
				) {
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

			if (g.IsObject(route.options.schema.query)) {
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

			if (g.IsObject(route.options.schema.params)) {
				operation.parameters ??= [];
				for (const [key, value] of Object.entries(
					route.options.schema.params.properties,
				)) {
					const description =
						"description" in value && typeof value.description === "string"
							? value.description
							: undefined;
					const ref = copy(schema(value));
					delete ref.description;
					operation.parameters.push({
						name: key,
						in: "path",
						required: true,
						description,
						schema: ref,
					});
				}
			}

			const url = route.prefix + this.replacePathParams(route.path);

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

	public replacePathParams(url: string): string {
		return url.replace(/:\w+/g, (match) => {
			const paramName = match.slice(1);
			return `{${paramName}}`;
		});
	}

	public getResponseSchema(route: ActionDescriptor<RequestConfigSchema>):
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

		if (t.schema.isObject(schema) || t.schema.isArray(schema)) {
			return {
				schema,
				status: 200,
				type: "application/json",
			};
		}

		if (t.schema.isString(schema)) {
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
		if (t.schema.isObject(schema[status]) || isTypeFile(schema[status])) {
			return {
				schema,
				type: t.schema.isObject(schema[status])
					? "application/json"
					: "application/octet-stream",
				status: Number(status),
			};
		}
	}

	protected configureSwaggerApi(
		prefix: string,
		json: OpenAPIV3.Document,
	): void {
		this.serverRouterProvider.createRoute({
			method: "GET",
			path: `${prefix}/json`,
			schema: {
				response: t.json(),
			},
			handler: () => json,
		});
		this.log.info(`Swagger API available at ${prefix}/json`);
	}

	protected async configureSwaggerUi(
		prefix: string,
		options: SwaggerDescriptorOptions,
	): Promise<void> {
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
			ui.root ??
			join(fileURLToPath(import.meta.url), "../../assets/swagger-ui");

		await this.serverStaticProvider.createStaticServer({
			path: prefix,
			root,
		});

		this.serverRouterProvider.createRoute({
			method: "GET",
			path: `${prefix}/swagger-initializer.js`,
			handler: ({ reply }) => {
				reply.headers["content-type"] = "application/javascript; charset=utf-8";
				return initializer;
			},
		});

		this.log.info(
			`Swagger UI available at ${this.serverProvider.hostname}${prefix}/`,
		);
	}
}
