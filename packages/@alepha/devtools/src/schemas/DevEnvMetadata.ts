import { type Infer, z } from "alepha";

export const devEnvMetadataSchema = z.object({
  /**
   * The property name in the service where $env is defined
   */
  propertyKey: z.text(),
  /**
   * The environment block's shape as JSON Schema.
   *
   * `.optional()` for the same reason as `DevAtomMetadata.schema` — see the
   * full explanation there. Both are fed by
   * `DevToolsMetadataProvider.toJsonSchema`, which returns `undefined` for any
   * schema JSON Schema cannot express, and a required field turns that into a
   * validation error the client hits and the server does not.
   *
   * Latent rather than observed: no `$env` schema in the monorepo is a
   * `z.custom()` today. It is fixed with the atom one because it is the same
   * defect and would surface the same undebuggable way.
   */
  schema: z.any().optional(),
  /**
   * The parsed values from the environment
   */
  values: z.record(z.text(), z.any()),
  /**
   * The service class name where this $env is defined
   */
  serviceName: z.text().optional(),
  /**
   * The module the declaring service belongs to. Used to group variables by
   * the subsystem that expects them.
   */
  moduleName: z.text().optional(),
});

export type DevEnvMetadata = Infer<typeof devEnvMetadataSchema>;
