import { type Static, t } from "alepha";

/**
 * Create config version body schema.
 */
export const createConfigVersionBodySchema = t.object({
  content: t.json({ description: "New configuration content" }),
  schemaHash: t.text({
    description: "Hash of the schema for migration detection",
  }),
  activationDate: t.optional(
    t.datetime({ description: "When to activate (default: now)" }),
  ),
  changeDescription: t.optional(
    t.text({ description: "Description of changes" }),
  ),
  tags: t.optional(t.array(t.text())),
  creatorId: t.optional(t.uuid()),
  creatorName: t.optional(t.text()),
});

export type CreateConfigVersionBody = Static<
  typeof createConfigVersionBodySchema
>;
