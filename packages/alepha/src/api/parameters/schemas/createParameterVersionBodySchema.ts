import { type Static, t } from "alepha";
import { parameters } from "../entities/parameters.ts";

/**
 * Create parameter version body schema.
 * Uses t.pick to derive from entity, with required fields made non-optional.
 */
export const createParameterVersionBodySchema = t.extend(
  t.pick(parameters.schema, [
    "content",
    "schemaHash",
    "changeDescription",
    "tags",
    "creatorId",
    "creatorName",
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
