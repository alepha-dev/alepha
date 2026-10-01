import { createPrimitive, KIND, Primitive } from "alepha";

/**
 * Creates an OpenAPI/Swagger documentation primitive with interactive UI.
 *
 * Automatically generates API documentation from your $action primitives and serves
 * an interactive Swagger UI for testing endpoints. Supports customization, tag filtering,
 * and OAuth configuration.
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
   * Enable Swagger UI.
   *
   * @default true
   */
  ui?: boolean | SwaggerUiOptions;

  /**
   * Function to rewrite the OpenAPI document before serving it.
   */
  rewrite?: (doc: OpenApiDocument) => void;
}

export interface OpenApiServer {
  url: string;
  description?: string;
}

export interface SwaggerUiOptions {
  root?: string;

  /**
   * If true, the authorization data is persisted in browser localStorage.
   *
   * @default true
   */
  persistAuthorization?: boolean;

  initOAuth?: {
    /**
     * Default clientId.
     */
    clientId?: string;

    /**
     * realm query parameter (for oauth1) added to authorizationUrl and tokenUrl.
     */
    realm?: string;

    /**
     * application name, displayed in authorization popup.
     */
    appName?: string;

    /**
     * scope separator for passing scopes, encoded before calling, default
     * value is a space (encoded value %20).
     *
     * @default ' '
     */
    scopeSeparator?: string;

    /**
     * string array or scope separator (i.e. space) separated string of
     * initially selected oauth scopes
     *
     * @default []
     */
    scopes?: string | string[];

    /**
     * Additional query parameters added to authorizationUrl and tokenUrl.
     * MUST be an object
     */
    additionalQueryStringParams?: { [key: string]: any };

    /**
     * Only activated for the accessCode flow. During the authorization_code
     * request to the tokenUrl, pass the Client Password using the HTTP Basic
     * Authentication scheme (Authorization header with Basic
     * base64encode(client_id + client_secret)).
     *
     * @default false
     */
    useBasicAuthenticationWithAccessCodeGrant?: boolean;

    /**
     * Only applies to Authorization Code flows. Proof Key for Code Exchange
     * brings enhanced security for OAuth public clients.
     *
     * @default false
     */
    usePkceWithAuthorizationCodeGrant?: boolean;
  };
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
