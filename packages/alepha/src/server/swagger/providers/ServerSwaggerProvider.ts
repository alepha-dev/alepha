import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  $atom,
  $hook,
  $inject,
  $state,
  Alepha,
  isTypeFile,
  type Static,
  type TObject,
  type TSchema,
  z,
} from "alepha";
import { $logger } from "alepha/logger";
import {
  $action,
  type ActionPrimitive,
  type RequestConfigSchema,
  ServerProvider,
  ServerRouterProvider,
} from "alepha/server";
import { ServerStaticProvider } from "alepha/server/static";
import { FileSystemProvider } from "alepha/system";
import {
  $swagger,
  type OpenApiDocument,
  type OpenApiOperation,
  type SwaggerPrimitiveOptions,
} from "../primitives/$swagger.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Swagger provider configuration atom
 */
export const swaggerOptions = $atom({
  name: "alepha.server.swagger.options",
  schema: z.object({
    excludeKeys: z
      .array(z.string())
      .describe("Keys to exclude from swagger schema")
      .optional(),
  }),
  default: {
    excludeKeys: [],
  },
  serverOnly: true,
});

export type ServerSwaggerProviderOptions = Static<typeof swaggerOptions.schema>;

declare module "alepha" {
  interface State {
    [swaggerOptions.key]: ServerSwaggerProviderOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export class ServerSwaggerProvider {
  protected readonly serverStaticProvider = $inject(ServerStaticProvider);
  protected readonly serverRouterProvider = $inject(ServerRouterProvider);
  protected readonly serverProvider = $inject(ServerProvider);
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly options = $state(swaggerOptions);
  protected readonly fs = $inject(FileSystemProvider);

  public json?: OpenApiDocument;

  protected readonly configure = $hook({
    on: "configure",
    priority: "last", // wait for all configurations, sometimes some actions are registered late!
    handler: async (alepha) => {
      const options = alepha.primitives($swagger)?.[0]?.options;
      if (!options) {
        return;
      }

      this.json = await this.setupSwaggerPlugin(options);
    },
  });

  public generateSwaggerDoc(options: SwaggerPrimitiveOptions): OpenApiDocument {
    const json = this.configureOpenApi(
      this.alepha.primitives($action),
      options,
    );

    if (options.rewrite) {
      options.rewrite(json);
    }

    return json;
  }

  protected async setupSwaggerPlugin(
    options: SwaggerPrimitiveOptions,
  ): Promise<OpenApiDocument | undefined> {
    if (options.disabled) {
      return;
    }

    const json = this.generateSwaggerDoc(options);

    const prefix = options.prefix ?? "/docs";

    this.configureSwaggerApi(prefix, json);

    if (options.ui !== false) {
      await this.configureSwaggerUi(prefix, options);
    } else {
      this.log.info(`Swagger API available at ${prefix}/json`);
    }

    return json;
  }

  protected configureOpenApi(
    actions: ActionPrimitive<RequestConfigSchema>[],
    doc: SwaggerPrimitiveOptions,
  ): OpenApiDocument {
    const openApi: OpenApiDocument = {
      openapi: "3.0.0",
      info: doc.info ?? {
        title: "API Documentation",
        version: "1.0.0",
      },
      servers: doc.servers ?? [{ url: this.serverProvider.hostname }],
      paths: {},
      components: {},
    };

    let hasSecurity = false;
    const excludeTags = doc.excludeTags ?? [];
    const schemas: Record<string, any> = {};

    const toJson = (source: TSchema): any => {
      let json: any;
      try {
        json = z.toJSONSchema(source as any);
      } catch {
        json = {};
      }
      // zod stamps a `$schema` dialect URL we don't want in OpenAPI fragments.
      json.$schema = undefined;
      this.removePrivateFields(json, [
        ...(this.options.excludeKeys || []),
        "~options",
      ]);
      return json;
    };

    const schema = (source: TSchema): any => {
      const json = toJson(source);
      // A titled schema is hoisted into `components/schemas` and referenced.
      const title =
        (typeof (source as any)?.meta === "function"
          ? (source as any).meta()?.title
          : undefined) ?? json.title;
      if (typeof title === "string") {
        schemas[title] = json;
        return { $ref: `#/components/schemas/${title}` };
      }
      return json;
    };

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

      const operation: OpenApiOperation = {
        operationId: route.name,
        summary: route.options.summary,
        description: route.options.description,
        deprecated: route.options.deprecated || undefined,
        tags: [route.group.replaceAll(":", " / ")],
        responses: {
          [response.status]: {
            description: this.getStatusDescription(response.status),
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

      const isSecured = route.middlewares.some((m) => m?.name === "$secure");

      if (isSecured) {
        operation.security = [{ bearerAuth: [] }];
        operation.responses["401"] = {
          description: "Unauthorized",
        };
        hasSecurity = true;
      }

      if (
        z.schema.isObject(route.options.schema.body) ||
        z.schema.isArray(route.options.schema.body)
      ) {
        if (
          z.schema.isObject(route.options.schema.body) &&
          this.isBodyMultipart(route.options.schema.body)
        ) {
          operation.requestBody = {
            required: true,
            content: {
              "multipart/form-data": {
                schema: schema(route.options.schema.body),
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

      if (z.schema.isObject(route.options.schema.query)) {
        operation.parameters ??= [];
        const requiredKeys: string[] = z.schema.requiredKeys(
          route.options.schema.query,
        );
        for (const [key, value] of Object.entries(
          route.options.schema.query.properties,
        )) {
          const param: any = {
            name: key,
            in: "query",
            required: requiredKeys.includes(key),
            schema: schema(value),
          };
          const example = this.extractExample(value);
          if (example !== undefined) param.example = example;
          operation.parameters.push(param);
        }
      }

      if (z.schema.isObject(route.options.schema.params)) {
        operation.parameters ??= [];
        for (const [key, value] of Object.entries(
          route.options.schema.params.properties,
        )) {
          const valueMeta =
            typeof (value as any)?.meta === "function"
              ? ((value as any).meta() ?? {})
              : {};
          const description =
            typeof valueMeta.description === "string"
              ? valueMeta.description
              : undefined;
          const ref = schema(value);
          ref.description = undefined;
          const param: any = {
            name: key,
            in: "path",
            required: true,
            description,
            schema: ref,
          };
          const example = this.extractExample(value);
          if (example !== undefined) param.example = example;
          operation.parameters.push(param);
        }
      }

      const hasValidation =
        operation.requestBody || operation.parameters?.length;
      if (hasValidation) {
        operation.responses["400"] = {
          description: "Bad Request",
        };
      }

      const url = route.prefix + this.replacePathParams(route.path);

      openApi.paths[url] = {
        ...openApi.paths[url],
        [route.method.toLowerCase()]: operation,
      };
    }

    if (hasSecurity && openApi.components) {
      openApi.components.securitySchemes = {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description:
            "Enter a JWT token or API key. Both are accepted as Bearer tokens.",
        },
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

  public getResponseSchema(route: ActionPrimitive<RequestConfigSchema>):
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

    if (z.schema.isObject(schema) || z.schema.isArray(schema)) {
      return {
        schema,
        status: 200,
        type: "application/json",
      };
    }

    if (z.schema.isString(schema)) {
      return {
        schema,
        status: 200,
        type: "text/plain",
      };
    }

    if (
      z.schema.isNumber(schema) ||
      z.schema.isInteger(schema) ||
      z.schema.isBoolean(schema)
    ) {
      return {
        schema,
        status: 200,
        type: "application/json",
      };
    }

    if (isTypeFile(schema)) {
      return {
        schema,
        status: 200,
        type: "application/octet-stream",
      };
    }

    // Status-code-keyed map: e.g. { 201: z.object({...}) }
    const status = Object.keys(schema)[0];
    if (status && !Number.isNaN(Number(status))) {
      const inner = schema[status];
      return {
        schema: inner,
        status: Number(status),
        type: this.getContentType(inner),
      };
    }
  }

  protected extractExample(schema: any): any {
    const meta =
      typeof schema?.meta === "function" ? (schema.meta() ?? {}) : {};
    if (Array.isArray(meta.examples) && meta.examples.length > 0) {
      return meta.examples[0];
    }
    if (meta.example !== undefined) {
      return meta.example;
    }
    const def = z.schema.getDefault(schema);
    if (def !== undefined) {
      return def;
    }
    return undefined;
  }

  protected getStatusDescription(status: number): string {
    switch (status) {
      case 200:
        return "OK";
      case 201:
        return "Created";
      case 204:
        return "No Content";
      case 400:
        return "Bad Request";
      case 401:
        return "Unauthorized";
      case 403:
        return "Forbidden";
      case 404:
        return "Not Found";
      case 500:
        return "Internal Server Error";
      default:
        return "";
    }
  }

  protected getContentType(schema: any): string | undefined {
    if (!schema) return undefined;
    if (z.schema.isObject(schema) || z.schema.isArray(schema)) {
      return "application/json";
    }
    if (z.schema.isString(schema)) return "text/plain";
    if (
      z.schema.isNumber(schema) ||
      z.schema.isInteger(schema) ||
      z.schema.isBoolean(schema)
    ) {
      return "application/json";
    }
    if (isTypeFile(schema)) return "application/octet-stream";
    return "application/json";
  }

  protected configureSwaggerApi(prefix: string, json: OpenApiDocument): void {
    this.serverRouterProvider.createRoute({
      method: "GET",
      path: `${prefix}/json`,
      schema: {
        response: z.json(),
      },
      handler: () => json,
    });
  }

  protected async configureSwaggerUi(
    prefix: string,
    options: SwaggerPrimitiveOptions,
  ): Promise<void> {
    const ui = typeof options.ui === "object" ? options.ui : {};
    const persistAuth = ui.persistAuthorization !== false;
    const initializer = `
window.onload = function() {
	window.ui = SwaggerUIBundle({
		url: "${prefix}/json",
		dom_id: '#swagger-ui',
		deepLinking: true,
		persistAuthorization: ${persistAuth},
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

    if (!this.alepha.isServerless()) {
      const dirname = fileURLToPath(import.meta.url);

      const root = await this.getAssetPath(
        ui.root,
        // TODO: this is shitty, take time to get the correct path
        join(dirname, "../../assets/swagger-ui"),
        join(dirname, "../../../assets/swagger-ui"),
        join(dirname, "../../../../assets/swagger-ui"),
        join(dirname, "../../../../../assets/swagger-ui"),
      );

      if (!root) {
        this.log.warn(`Failed to locate Swagger UI assets for path ${prefix}`);
        return;
      }

      await this.serverStaticProvider.createStaticServer({
        path: prefix,
        root,
      });
    }

    this.serverRouterProvider.createRoute({
      method: "GET",
      path: `${prefix}/swagger-initializer.js`,
      handler: ({ reply }) => {
        reply.headers["content-type"] = "application/javascript; charset=utf-8";
        return initializer;
      },
    });

    this.log.info("SwaggerUI OK", {
      url: `${this.serverProvider.hostname}${prefix}`,
    });
  }

  protected async getAssetPath(
    ...paths: (string | undefined)[]
  ): Promise<string | undefined> {
    for (const path of paths) {
      if (!path) continue;
      const exists = await this.fs.exists(path);
      if (exists) {
        return path;
      }
    }
  }

  public removePrivateFields<T extends Record<string, any>>(
    obj: T,
    excludeList: string[],
  ): T {
    if (obj === null || typeof obj !== "object") return obj;

    const visited = new WeakSet();

    const traverse = (o: any): void => {
      if (visited.has(o)) return;
      visited.add(o);

      if (Array.isArray(o)) {
        for (let i = 0; i < o.length; i++) {
          const item = o[i];
          if (item !== null && typeof item === "object") {
            traverse(item);
          }
        }
      } else {
        for (const excludeKey of excludeList) {
          if (excludeKey in o) {
            delete o[excludeKey];
          }
        }
        for (const key in o) {
          const item = o[key];
          if (item !== null && typeof item === "object") {
            traverse(item);
          }
        }
      }
    };

    traverse(obj);
    return obj;
  }
}
