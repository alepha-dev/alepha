import { AlephaError } from "alepha";
import { $logger } from "alepha/logger";
import type { ContainerPrimitive } from "../primitives/$container.ts";

export interface ContainerInvokeConfig {
  body?: unknown;
  query?: Record<string, unknown>;
  params?: Record<string, unknown>;
  headers?: Record<string, string>;
}

/**
 * Abstract transport for `$container` proxies.
 *
 * Concrete subclasses translate a `(container, action, config)` call
 * into an HTTP request that reaches the running container. The default
 * binding on Node throws — apps must register either a
 * `NodeContainerProvider` (with `url` on each primitive) or the
 * Cloudflare workerd variant.
 */
export abstract class ContainerProvider {
  protected readonly log = $logger();

  /**
   * Invoke a remote action on the container. Subclasses do the work;
   * the default implementation rejects to make missing wiring obvious.
   */
  public async invoke(
    container: ContainerPrimitive,
    action: string,
    config: ContainerInvokeConfig,
  ): Promise<unknown> {
    void config;
    throw new AlephaError(
      `No ContainerProvider configured for container '${container.name}' (action '${action}'). ` +
        `Set up alepha/containers via AlephaContainers and either supply 'url' (Node) or build for target=cloudflare.`,
    );
  }

  /**
   * Helper: build the fetch path/body for an action call. Kept as a
   * protected method so workerd and Node providers share the wire
   * shape — `POST /api/<action>` with the JSON body, query params on
   * the URL, and the request headers merged in.
   */
  protected buildRequest(
    action: string,
    config: ContainerInvokeConfig,
  ): { path: string; init: RequestInit } {
    const params = new URLSearchParams();
    if (config.query) {
      for (const [k, v] of Object.entries(config.query)) {
        if (v !== undefined && v !== null) params.set(k, String(v));
      }
    }

    let path = `/api/${action}`;
    if (config.params) {
      for (const [k, v] of Object.entries(config.params)) {
        path = path.replace(`:${k}`, encodeURIComponent(String(v)));
      }
    }

    const search = params.toString();
    if (search) path += `?${search}`;

    const init: RequestInit = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.headers ?? {}),
      },
      body: config.body !== undefined ? JSON.stringify(config.body) : undefined,
    };

    return { path, init };
  }
}
