import type { DurationLike } from "alepha/datetime";

/**
 * Options for the `$container` primitive.
 *
 * Describes a remote Alepha app running in an ephemeral container. The
 * primitive returns a typed Proxy that calls the container's `$action`
 * endpoints through whatever transport the active provider chooses
 * (Cloudflare Containers binding on `target=cloudflare`, plain HTTP on
 * Node when `url` is set).
 */
export interface ContainerPrimitiveOptions {
  /**
   * Logical container name. Defaults to the property key.
   *
   * Cloudflare provider uppercases this to look up the binding
   * (`env.<NAME>`), so prefer lowercase here.
   */
  name?: string;

  /**
   * Docker image the container runs. Required.
   *
   * The build task uses this verbatim in `wrangler.jsonc`'s
   * `containers[].image` entry.
   */
  image: string;

  /**
   * Explicit URL the Node provider should call. When set, `$container`
   * routes through `LinkProvider` exactly like `$remote({ url })`.
   *
   * On `target=cloudflare`, this is ignored — the Containers binding is
   * used instead.
   */
  url?: string | (() => string);

  /**
   * Port the container app listens on. Defaults to 3000 (Alepha
   * convention — NOT Cloudflare's 8080). Used in build-time codegen.
   */
  port?: number;

  /**
   * Idle window before the platform stops the container instance.
   *
   * @default "15m"
   */
  sleepAfter?: DurationLike;

  /**
   * Environment variables injected into the container at runtime.
   */
  envVars?: Record<string, string>;

  /**
   * Cloudflare-specific instance class. Ignored on other targets.
   *
   * @default "dev"
   */
  instanceType?: "dev" | "basic" | "standard";

  /**
   * Maximum concurrent container instances.
   *
   * @default 5
   */
  maxInstances?: number;
}
