import { $inject, createPrimitive, KIND, Primitive } from "alepha";
import type { ServerRequest } from "alepha/server";
import type {
  BasicAuthOptions,
  BasicAuthPrimitiveConfig,
} from "../providers/ServerBasicAuthProvider.ts";
import { ServerBasicAuthProvider } from "../providers/ServerBasicAuthProvider.ts";

/**
 * Declares HTTP Basic Authentication for server routes.
 * This primitive provides methods to protect routes with username/password authentication.
 */
export const $basicAuth = (
  options: BasicAuthPrimitiveConfig,
): AbstractBasicAuthPrimitive => {
  return createPrimitive(BasicAuthPrimitive, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface AbstractBasicAuthPrimitive {
  readonly name: string;
  readonly options: BasicAuthPrimitiveConfig;
  check(request: ServerRequest, options?: BasicAuthOptions): void;
}

export class BasicAuthPrimitive
  extends Primitive<BasicAuthPrimitiveConfig>
  implements AbstractBasicAuthPrimitive
{
  protected readonly serverBasicAuthProvider = $inject(ServerBasicAuthProvider);

  public get name(): string {
    return this.options.name ?? `${this.config.propertyKey}`;
  }

  protected onInit() {
    // Register this auth configuration with the provider
    this.serverBasicAuthProvider.registerAuth(this.options);
  }

  /**
   * Checks basic auth for the given request using this primitive's configuration.
   */
  public check(request: ServerRequest, options?: BasicAuthOptions): void {
    const mergedOptions = { ...this.options, ...options };
    this.serverBasicAuthProvider.checkAuth(request, mergedOptions);
  }
}

$basicAuth[KIND] = BasicAuthPrimitive;
