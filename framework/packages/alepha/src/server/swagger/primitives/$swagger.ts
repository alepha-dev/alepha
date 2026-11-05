import { createPrimitive, Primitive } from "alepha";
import { KIND } from "alepha/internal";

/**
 * Creates an OpenAPI documentation primitive.
 *
 * Generates an OpenAPI 3 document from your $action primitives and serves it as
 * JSON at `<prefix>/json`. Supports customization and tag filtering. It serves no
 * viewer: point any OpenAPI viewer at the JSON route.
 *
 * @example
 * ```ts
 * class App {
 *   docs = $swagger({
 *     prefix: "/api-docs",
 *     info: {
 *       title: "My API",
 *       version: "1.0.0",
 *       description: "REST API documentation"
 *     },
 *     excludeTags: ["internal"],
 *     prefix: "/docs", // URL mount point (default)
 *   });
 * }
 * ```
 */
export const $swagger = (
  options: SwaggerPrimitiveOptions = {},
): SwaggerPrimitive => {
  return createPrimitive(SwaggerPrimitive, options);
};

export interface SwaggerPrimitiveOptions {
  info?: OpenApiDocument["info"];

  /**
   * @default: "/docs"
   */
  prefix?: string;

  /**
   * If true, docs will be disabled.
   */
  disabled?: boolean;

  /**
   * Tags to exclude from the documentation.
   */
  excludeTags?: string[];

  /**
   * Server URLs for the API.
   * If not provided, the server hostname is used automatically.
   */
  servers?: OpenApiServer[];

  /**
   * Function to rewrite the OpenAPI document before serving it.
   */
  rewrite?: (doc: OpenApiDocument) => void;
}

export interface OpenApiServer {
  url: string;
  description?: string;
}

export class SwaggerPrimitive extends Primitive<SwaggerPrimitiveOptions> {}

$swagger[KIND] = SwaggerPrimitive;

export interface OpenApiDocument {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers?: OpenApiServer[];
  paths: Record<string, any>;
  components?: {
    schemas?: Record<string, any>;
    securitySchemes?: Record<string, any>;
  };
}

export interface OpenApiOperation {
  /**
   * Vendor extensions. Alepha writes `x-alepha-action`, `x-alepha-middlewares`,
   * `x-alepha-security`, `x-alepha-errors` and `x-alepha-timeout`; see
   * `ServerSwaggerProvider.documentAlephaMetadata`.
   */
  [extension: `x-${string}`]: unknown;
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  deprecated?: boolean;
  parameters?: Array<{
    name: string;
    in: "query" | "header" | "path" | "cookie";
    description?: string;
    required?: boolean;
    schema: any;
  }>;
  requestBody?: {
    description?: string;
    content: Record<
      string,
      {
        schema: any;
      }
    >;
    required?: boolean;
  };
  responses: Record<
    string,
    {
      description: string;
      content?: Record<
        string,
        {
          schema: any;
        }
      >;
    }
  >;
  security?: Array<Record<string, any[]>>;
}
