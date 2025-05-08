import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	$hook,
	$inject,
	Alepha,
	type Static,
	type TObject,
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
} from "../descriptors/$swagger.ts";

const envSchema = t.object({
	SERVER_OPENAPI_PREFIX: t.string({ default: "/docs" }),
	SERVER_OPENAPI_EXCLUDE_TAGS: t.string({
		description:
			"Comma-separated list of tags to exclude from the OpenAPI document.",
		default: "",
	}),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

export class ServerSwaggerProvider {
	protected readonly serverActionProvider = $inject(
		ServerActionDescriptorProvider,
	);
	protected readonly env = $inject(envSchema);
	protected readonly serverStaticProvider = $inject(ServerStaticProvider);
	protected readonly serverRouterProvider = $inject(ServerRouterProvider);
	protected readonly alepha = $inject(Alepha);

	protected readonly configure = $hook({
		name: "configure",
		after: this.serverActionProvider,
		handler: async (alepha) => {
			const doc = alepha.getDescriptorValues($swagger)?.[0];
			if (!doc || doc.value.options.disabled) {
				return;
			}

			const options = doc.value.options;

			const json = this.configureOpenApi(options);

			doc.instance[doc.key].json = () => json;

			await this.configureSwaggerApi(json);
			await this.configureSwaggerUi(options);
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

		const excludeTags = this.env.SERVER_OPENAPI_EXCLUDE_TAGS.split(",");

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
				summary: route.name,
				description: route.options.description,
				tags: [route.group],
				responses: {
					[response.status]: {
						description: "",
						content: response.type
							? {
									[response.type]: {
										schema: response.schema,
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
								schema: route.options.schema.body,
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
						schema: value,
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
						schema: value,
					});
				}
			}

			const url = this.replacePathParams(route.path);

			openApi.paths[url] = {
				...openApi.paths[url],
				[route.method.toLowerCase()]: operation,
			};
		}

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

		if (TypeGuard.IsObject(schema) || isTypeFile(schema)) {
			return {
				schema,
				status: 200,
				type: TypeGuard.IsObject(schema)
					? "application/json"
					: "application/octet-stream",
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

	protected async configureSwaggerApi(json: OpenAPIV3.Document) {
		this.serverRouterProvider.route({
			method: "GET",
			path: `${this.env.SERVER_OPENAPI_PREFIX}/json`,
			schema: {
				response: t.json(),
			},
			handler: () => json,
		});
	}

	protected async configureSwaggerUi(options: SwaggerDescriptorOptions) {
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
				layout: "StandaloneLayout"
			});
		};
		`;

		const root = join(import.meta.filename, "../../../assets/swagger-ui");

		await this.serverStaticProvider.serve({
			path: options.prefix ?? this.env.SERVER_OPENAPI_PREFIX,
			root,
		});

		await writeFile(join(root, "swagger-initializer.js"), initializer);
	}
}
