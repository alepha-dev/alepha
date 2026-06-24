import { type Static, z } from "alepha";
import { parameters } from "../entities/parameters.ts";

/**
 * Create parameter version body schema.
 * Uses z.pick to derive from entity, with required fields made non-optional.
 *
 * Creator fields are intentionally omitted: the controller captures the
 * authenticated user server-side, so they cannot be spoofed by the client.
 */
export const createParameterVersionBodySchema = parameters.schema
  .pick({
    content: true,
    schemaHash: true,
    changeDescription: true,
    tags: true,
  })
  .extend({
    activationDate: z
      .datetime()
      .describe("When to activate (default: now)")
      .optional(),
  });

export type CreateParameterVersionBody = Static<
  typeof createParameterVersionBodySchema
>;
