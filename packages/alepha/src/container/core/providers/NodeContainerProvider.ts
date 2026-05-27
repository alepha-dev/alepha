import { AlephaError } from "alepha";
import type { ContainerPrimitive } from "../primitives/$container.ts";
import {
  type ContainerInvokeConfig,
  ContainerProvider,
} from "./ContainerProvider.ts";

/**
 * Node (dev / test / non-Cloudflare) container provider.
 *
 * Routes proxy calls through plain `fetch()` against the URL given on
 * the `$container` primitive. If no `url` is supplied, calls throw —
 * v1 deliberately has no Docker spawning. This is the "temporary, not
 * perfect" Node path documented in the spec; the longer-term plan is
 * to plug in a `target=docker` adapter once that lands.
 */
export class NodeContainerProvider extends ContainerProvider {
  public override async invoke(
    container: ContainerPrimitive,
    action: string,
    config: ContainerInvokeConfig,
  ): Promise<unknown> {
    const url = this.resolveUrl(container);
    if (!url) {
      throw new AlephaError(
        `Container '${container.name}' has no 'url' configured — NodeContainerProvider cannot reach the container.`,
      );
    }

    const { path, init } = this.buildRequest(action, config);
    const response = await fetch(`${url.replace(/\/$/, "")}${path}`, init);

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new AlephaError(
        `Container '${container.name}' action '${action}' failed: ${response.status} ${response.statusText}${
          text ? ` — ${text}` : ""
        }`,
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return await response.json();
    }
    return await response.text();
  }

  protected resolveUrl(container: ContainerPrimitive): string | undefined {
    const url = container.options.url;
    return typeof url === "function" ? url() : url;
  }
}
