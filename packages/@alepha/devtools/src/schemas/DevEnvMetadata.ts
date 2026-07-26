import { type Static, z } from "alepha";

export const devEnvMetadataSchema = z.object({
  /**
   * The property name in the service where $env is defined
   */
  propertyKey: z.text(),
  /**
   * The schema for the environment variables (TypeBox/JSON Schema)
   */
  schema: z.any(),
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

export type DevEnvMetadata = Static<typeof devEnvMetadataSchema>;
