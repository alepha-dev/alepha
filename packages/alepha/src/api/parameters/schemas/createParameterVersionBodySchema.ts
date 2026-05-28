import { type Static, t } from "alepha";
import { parameters } from "../entities/parameters.ts";

/**
 * Create parameter version body schema.
 * Uses t.pick to derive from entity, with required fields made non-optional.
 *
 * Creator fields are intentionally omitted: the controller captures the
 * authenticated user server-side, so they cannot be spoofed by the client.
 */
export const createParameterVersionBodySchema = t.extend(
  t.pick(parameters.schema, [
    "content",
    "schemaHash",
    "changeDescription",
    "tags",
  ]),
  {
    activationDate: t.optional(
      t.datetime({ description: "When to activate (default: now)" }),
    ),
  },
);

export type CreateParameterVersionBody = Static<
  typeof createParameterVersionBodySchema
>;
