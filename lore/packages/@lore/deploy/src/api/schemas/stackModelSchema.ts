import type { Infer } from "alepha";
import { z } from "alepha";

import { stackModelServiceSchema } from "./stackModelServiceSchema.ts";

/**
 * The target-neutral model of a stack revision, parsed from its
 * `compose.yml` at upload and stored on the revision as JSON.
 *
 * Every target reads THIS, never the YAML: Bay applies the compose file it
 * is sent, but Lore's own checks, the console and a later Cloudflare or
 * Kubernetes target all work from the model.
 */
export const stackModelSchema = z.object({
  version: z.literal(1),
  services: z.array(stackModelServiceSchema),
  /**
   * Named volumes, by their compose name.
   */
  volumes: z.array(z.string()),
  /**
   * Every `${VAR}` the file interpolates. `required` when it has no default,
   * which is what a deploy refuses to dispatch while unset.
   */
  variables: z.array(z.object({ name: z.string(), required: z.boolean() })),
});

export type StackModel = Infer<typeof stackModelSchema>;
