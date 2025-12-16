import { $inject, createPrimitive, KIND, Primitive } from "alepha";
import type { CorsOptions } from "../providers/ServerCorsProvider.ts";
import { ServerCorsProvider } from "../providers/ServerCorsProvider.ts";

/**
 * Declares CORS configuration for specific server routes.
 * This primitive provides path-based CORS configuration.
 *
 * @example
 * ```ts
 * class ApiService {
 *   // Apply specific CORS to API routes
 *   cors = $cors({
 *     paths: ["/api/*"],
 *     origin: "https://app.example.com",
 *     credentials: true,
 *   });
 * }
 * ```
 */
export const $cors = (options: CorsPrimitiveConfig): AbstractCorsPrimitive => {
  return createPrimitive(CorsPrimitive, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface CorsPrimitiveConfig extends Partial<CorsOptions> {
  /** Name identifier for this CORS config (default: property key) */
  name?: string;
  /** Path patterns to match (supports wildcards like /api/*) */
  paths?: string[];
}

// ---------------------------------------------------------------------------------------------------------------------

export interface AbstractCorsPrimitive {
  readonly name: string;
  readonly options: CorsPrimitiveConfig;
}

export class CorsPrimitive
  extends Primitive<CorsPrimitiveConfig>
  implements AbstractCorsPrimitive
{
  protected readonly serverCorsProvider = $inject(ServerCorsProvider);

  public get name(): string {
    return this.options.name ?? `${this.config.propertyKey}`;
  }

  protected onInit() {
    // Register this CORS configuration with the provider
    this.serverCorsProvider.registerCors(this.options);
  }
}

$cors[KIND] = CorsPrimitive;
