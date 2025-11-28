import { $inject, createDescriptor, Descriptor, KIND } from "alepha";
import type { CorsOptions } from "../providers/ServerCorsProvider.ts";
import { ServerCorsProvider } from "../providers/ServerCorsProvider.ts";

/**
 * Declares CORS configuration for specific server routes.
 * This descriptor provides path-based CORS configuration.
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
export const $cors = (
  options: CorsDescriptorConfig,
): AbstractCorsDescriptor => {
  return createDescriptor(CorsDescriptor, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface CorsDescriptorConfig extends Partial<CorsOptions> {
  /** Name identifier for this CORS config (default: property key) */
  name?: string;
  /** Path patterns to match (supports wildcards like /api/*) */
  paths?: string[];
}

// ---------------------------------------------------------------------------------------------------------------------

export interface AbstractCorsDescriptor {
  readonly name: string;
  readonly options: CorsDescriptorConfig;
}

export class CorsDescriptor
  extends Descriptor<CorsDescriptorConfig>
  implements AbstractCorsDescriptor
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

$cors[KIND] = CorsDescriptor;
