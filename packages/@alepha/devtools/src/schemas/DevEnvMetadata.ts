import { type Static, t } from "alepha";

export const devEnvMetadataSchema = t.object({
  /**
   * The property name in the service where $env is defined
   */
  propertyKey: t.text(),
  /**
   * The schema for the environment variables (TypeBox/JSON Schema)
   */
  schema: t.any(),
  /**
   * The parsed values from the environment
   */
  values: t.record(t.text(), t.any()),
  /**
   * The service class name where this $env is defined
   */
  serviceName: t.optional(t.text()),
});

export type DevEnvMetadata = Static<typeof devEnvMetadataSchema>;
