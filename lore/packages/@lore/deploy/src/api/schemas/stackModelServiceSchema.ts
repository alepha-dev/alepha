import type { Infer } from "alepha";
import { z } from "alepha";

/**
 * One service of a stack, as the target-neutral model holds it.
 *
 * ⚠️ Named for what a service IS, never for a Compose key: a later target
 * (Cloudflare, Kubernetes) maps from these fields, so `container_name`
 * becomes {@link fixedName}, `network_mode: host` becomes an entry of
 * {@link hostNamespaces}, and a target decides what it refuses from them.
 */
export const stackModelServiceSchema = z.object({
  name: z.string(),
  /**
   * `app` for an `x-lore: { app }` service, which the target runs from an
   * artifact deployed under {@link app}; `service` for one run from its image.
   */
  kind: z.enum(["app", "service"]),
  app: z.string().optional(),
  image: z.string().optional(),
  /**
   * Route labels relative to the environment's base domain (`@`, `auth`).
   */
  routes: z.array(z.string()),
  /**
   * The container port routes reach, when declared.
   */
  port: z.integer().optional(),
  /**
   * A container port opened as raw TCP (MQTT over TLS).
   */
  tcp: z.integer().optional(),
  /**
   * Every container port the file publishes.
   */
  ports: z.array(z.integer()),
  mounts: z.array(
    z.object({
      kind: z.enum(["volume", "bundle", "host", "socket", "anonymous"]),
      source: z.string().optional(),
      target: z.string(),
    }),
  ),
  dependsOn: z.array(z.string()),
  healthcheck: z.boolean(),
  /**
   * Names only: values stay in the compose text, never in the model.
   */
  environment: z.array(z.string()),
  backup: z
    .union([
      z.object({
        kind: z.literal("postgres"),
        user: z.string(),
        db: z.string(),
      }),
      z.object({
        kind: z.literal("command"),
        command: z.string(),
        restore: z.string().optional(),
      }),
    ])
    .optional(),
  runtime: z.string().optional(),
  fixedName: z.boolean(),
  build: z.boolean(),
  privileged: z.boolean(),
  /**
   * The host namespaces the service asks to share: `network`, `pid`, `ipc`,
   * `userns`.
   */
  hostNamespaces: z.array(z.string()),
});

export type StackModelService = Infer<typeof stackModelServiceSchema>;
