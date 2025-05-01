import type { Static } from "@alepha/core";
import { $hook, $inject, $logger, Alepha, t } from "@alepha/core";
import { SecurityModule } from "@alepha/security";
import type { FastifyDynamicSwaggerOptions } from "@fastify/swagger";
import fastifySwagger from "@fastify/swagger";
import type { FastifySwaggerUiOptions } from "@fastify/swagger-ui";
import fastifySwaggerUi from "@fastify/swagger-ui";
import type { OpenAPI, OpenAPIV3 } from "openapi-types";
import { FastifyServerProvider } from "./FastifyServerProvider";
export type { OpenAPIV3 } from "openapi-types";

export type FastifyOpenApiProviderOptions = FastifyDynamicSwaggerOptions;
export type FastifyOpenApiProviderUiOptions = FastifySwaggerUiOptions;

const envSchema = t.object({
	SERVER_OPENAPI_PREFIX: t.string({ default: "/docs" }),

	/**
	 * Comma-separated list of tags to exclude from the OpenAPI document.
	 *
	 * @example "system,security"
	 * @default ""
	 */
	SERVER_OPENAPI_EXCLUDE_TAGS: t.string({
		description:
			"Comma-separated list of tags to exclude from the OpenAPI document.",
		default: "",
	}),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

export class FastifyOpenApiProvider {
	protected readonly alepha = $inject(Alepha);
	protected readonly log = $logger();
	protected readonly env = $inject(envSchema);
	protected readonly fastifyProvider = $inject(FastifyServerProvider);

	/**
	 * Returns the OpenAPI JSON document.
	 */
	public json(): OpenAPI.Document {
		return this.fastifyProvider.app.swagger();
	}

	protected readonly configure = $hook({
		name: "configure:fastify",
		handler: async (app) => {
			await app.register(fastifySwagger, this.options());
			await app.register(fastifySwaggerUi, this.uiOptions());
			this.log.info(
				`OpenApi is enabled, available at ${this.fastifyProvider.hostname}${this.env.SERVER_OPENAPI_PREFIX}`,
			);
		},
	});

	/**
	 * Returns the options for the OpenAPI documentation.
	 *
	 * @param override
	 */
	public options(
		override: FastifyOpenApiProviderOptions = {},
	): FastifyOpenApiProviderOptions {
		const excludeTags = this.env.SERVER_OPENAPI_EXCLUDE_TAGS.split(",");
		const hasSecurity = this.alepha.has(SecurityModule);

		return {
			hideUntagged: true,
			openapi: {},
			transformObject: (obj) => {
				if (!("openapiObject" in obj)) {
					return {};
				}

				const { openapiObject } = obj;
				const schemas: Record<string, any> = {};

				if (typeof openapiObject.paths === "object") {
					for (const [pathKey, path] of Object.entries(openapiObject.paths)) {
						if (typeof path === "object") {
							for (const [opeKey, operation] of Object.entries(path)) {
								if (
									typeof operation === "object" &&
									"tags" in operation &&
									Array.isArray(operation.tags)
								) {
									// feature: hide tags
									for (const item of excludeTags) {
										if (operation.tags.includes(item)) {
											delete (openapiObject as any).paths[pathKey][opeKey];
											break;
										}
									}

									// feature: security
									if (operation.security) {
										operation.security = [{ bearerAuth: [] }];
									}

									// feature: configure operation
									this.configureOperation(operation);
								}
							}
						}
					}
				}

				// feature: extract schemas and replace them with $ref
				const extractSchemas = (target: any, key: string) => {
					if (
						typeof target[key] === "object" &&
						typeof target[key].title === "string" &&
						typeof target[key].properties === "object"
					) {
						schemas[target[key].title] = { ...target[key] };
						forEachProperties(target[key], extractSchemas);
						target[key] = {
							$ref: `#/components/schemas/${target[key].title}`,
						};
					}
				};

				forEachProperties(openapiObject, extractSchemas);

				// merge extracted $ref schemas
				return Object.assign({}, openapiObject, {
					components: {
						...openapiObject.components,
						securitySchemes: hasSecurity
							? {
									bearerAuth: {
										type: "http",
										scheme: "bearer",
										bearerFormat: "JWT",
									},
								}
							: undefined,
						schemas,
					},
				});
			},
			...override,
		};
	}

	/**
	 * Returns the UI options for the OpenAPI documentation.
	 *
	 * @param override
	 */
	public uiOptions(
		override: FastifyOpenApiProviderUiOptions = {},
	): FastifyOpenApiProviderUiOptions {
		return {
			routePrefix: this.env.SERVER_OPENAPI_PREFIX,
			...override,
		};
	}

	// -------------------------------------------------------------------------------------------------------------------

	/**
	 * Configure an operation.
	 * This method is called for each operation in the OpenAPI document.
	 *
	 * @param operation The operation to configure.
	 * @protected
	 */
	protected configureOperation(operation: OpenAPIV3.OperationObject): void {
		// override this method to configure operations
	}
}

// ---------------------------------------------------------------------------------------------------------------------

function forEachProperties(
	obj: any,
	run: (target: Record<string, any>, key: string) => void,
) {
	if (typeof obj !== "object" || !obj) {
		return;
	}

	if (Array.isArray(obj)) {
		for (const it of obj) {
			forEachProperties(it, run);
		}
		return;
	}

	for (const key of Object.keys(obj)) {
		run(obj, key);
		forEachProperties(obj[key], run);
	}
}
