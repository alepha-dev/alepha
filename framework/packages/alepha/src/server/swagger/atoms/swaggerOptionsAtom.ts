import { $atom, type Infer, z } from "alepha";

/**
 * Schema for the swagger provider configuration atom.
 */
export const swaggerOptionsAtomSchema = z.object({
  excludeKeys: z
    .array(z.string())
    .describe("Keys to exclude from swagger schema")
    .optional(),
});

/**
 * Swagger provider configuration atom
 */
export const swaggerOptions = $atom({
  name: "alepha.server.swagger.options",
  schema: swaggerOptionsAtomSchema,
  default: {
    excludeKeys: [],
  },
  serverOnly: true,
});

export type ServerSwaggerProviderOptions = Infer<
  typeof swaggerOptionsAtomSchema
>;

declare module "alepha" {
  interface State {
    [swaggerOptions.key]: ServerSwaggerProviderOptions;
  }
}
