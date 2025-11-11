import { $inject, createDescriptor, Descriptor, KIND } from "@alepha/core";
import type { ServerRequest } from "@alepha/server";
import type {
  BasicAuthDescriptorConfig,
  BasicAuthOptions,
} from "../providers/ServerBasicAuthProvider.ts";
import { ServerBasicAuthProvider } from "../providers/ServerBasicAuthProvider.ts";

/**
 * Declares HTTP Basic Authentication for server routes.
 * This descriptor provides methods to protect routes with username/password authentication.
 */
export const $basicAuth = (
  options: BasicAuthDescriptorConfig,
): AbstractBasicAuthDescriptor => {
  return createDescriptor(BasicAuthDescriptor, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface AbstractBasicAuthDescriptor {
  readonly name: string;
  readonly options: BasicAuthDescriptorConfig;
  check(request: ServerRequest, options?: BasicAuthOptions): void;
}

export class BasicAuthDescriptor
  extends Descriptor<BasicAuthDescriptorConfig>
  implements AbstractBasicAuthDescriptor
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
   * Checks basic auth for the given request using this descriptor's configuration.
   */
  public check(request: ServerRequest, options?: BasicAuthOptions): void {
    const mergedOptions = { ...this.options, ...options };
    this.serverBasicAuthProvider.checkAuth(request, mergedOptions);
  }
}

$basicAuth[KIND] = BasicAuthDescriptor;
