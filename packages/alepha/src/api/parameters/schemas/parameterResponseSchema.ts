import { type Static, t } from "alepha";
import { parameterStatusSchema } from "./parameterStatusSchema.ts";

/**
 * Parameter response schema for API responses.
 */
export const parameterResponseSchema = t.object({
  id: t.uuid(),
  createdAt: t.datetime(),
  updatedAt: t.datetime(),
  name: t.text(),
  content: t.json(),
  schemaHash: t.text(),
  status: parameterStatusSchema,
  activationDate: t.datetime(),
  expiredAt: t.optional(t.datetime()),
  version: t.integer(),
  changeDescription: t.optional(t.text()),
  tags: t.optional(t.array(t.text())),
  creatorId: t.optional(t.uuid()),
  creatorName: t.optional(t.text()),
  previousContent: t.optional(t.json()),
  migrationLog: t.optional(t.text()),
});

export type ParameterResponse = Static<typeof parameterResponseSchema>;
