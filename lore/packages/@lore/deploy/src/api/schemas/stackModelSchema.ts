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
   * The named volumes declaring `driver_opts`, which Bay refuses. Absent on a
   * revision stored before Bay did.
   */
  volumesWithDriverOpts: z.array(z.string()).optional(),
  /**
   * The named volumes setting `name:`, which Bay refuses, external ones left
   * out. Absent on a revision stored before Bay did.
   */
  volumesWithName: z.array(z.string()).optional(),
  /**
   * The named volumes marked `external`, which Bay refuses. Absent on a
   * revision stored before Bay did.
   */
  volumesExternal: z.array(z.string()).optional(),
  /**
   * The networks setting `name:`, which Bay refuses, external ones left out.
   * Absent on a revision stored before Bay did.
   */
  networksWithName: z.array(z.string()).optional(),
  /**
   * The networks marked `external`, which Bay refuses. Absent on a revision
   * stored before Bay did.
   */
  networksExternal: z.array(z.string()).optional(),
  /**
   * The secrets and configs read from a file outside the bundle, which Bay
   * refuses. Absent on a revision stored before Bay did.
   */
  hostFiles: z
    .array(
      z.object({
        kind: z.enum(["secret", "config"]),
        name: z.string(),
        source: z.string(),
      }),
    )
    .optional(),
  /**
   * Whether the file declares `include`, which Bay refuses. Absent on a
   * revision stored before Bay did.
   */
  usesInclude: z.boolean().optional(),
  /**
   * Every `${VAR}` the file interpolates. `required` when it has no default,
   * which is what a deploy refuses to dispatch while unset.
   */
  variables: z.array(z.object({ name: z.string(), required: z.boolean() })),
});

export type StackModel = Infer<typeof stackModelSchema>;
