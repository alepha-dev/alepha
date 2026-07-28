import { type Static, z } from "alepha";
import { parameters } from "../entities/parameters.ts";

/**
 * Create parameter version body schema.
 * Uses z.pick to derive from entity, with required fields made non-optional.
 *
 * Creator fields are intentionally omitted: the controller captures the
 * authenticated user server-side, so they cannot be spoofed by the client.
 *
 * `schemaHash` is omitted for the same reason, and it matters more. `save()`
 * skips content validation when the supplied hash differs from the registered
 * one — the escape hatch that lets a migration seed restore content written
 * under an older schema. Accepting that hash from the client turned the escape
 * hatch into a bypass: any junk hash stored arbitrary JSON that typed
 * `$parameter.get()` consumers then read as `Static<T>`. The server always
 * supplies the registered hash instead.
 */
export const createParameterVersionBodySchema = parameters.schema
  .pick({
    content: true,
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
