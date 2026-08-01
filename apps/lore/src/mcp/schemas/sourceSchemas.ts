import { z } from "alepha";
import { campaignParamsSchema } from "./commonSchemas.ts";

// -----------------------------------------------------------------------------
// source_list
// -----------------------------------------------------------------------------

/**
 * A source as it can safely be listed.
 *
 * No token, ever — only its prefix and suffix, which is what lets someone match
 * a row against a key they are holding without the row being one.
 */
const sourceRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  tokenPrefix: z.string(),
  tokenSuffix: z.string().optional(),
  scopes: z.array(z.string()),
  createdAt: z.string(),
  revokedAt: z.string().optional(),
  lastUsedAt: z.string().optional(),
});

export const sourceListParamsSchema = campaignParamsSchema;

export const sourceListResultSchema = z.object({
  sources: z.array(sourceRefSchema),
});

// -----------------------------------------------------------------------------
// source_create
// -----------------------------------------------------------------------------

export const sourceCreateParamsSchema = campaignParamsSchema.extend({
  name: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "What is reporting — a Sigil instance, a CI pipeline. Shown next to every blight it files.",
    ),
});

export const sourceCreateResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  /**
   * Returned once and never again: only a hash is stored.
   *
   * Said in the schema and not just the description because an agent that
   * discards this has no way to recover it — the only path forward is to
   * revoke and create another.
   */
  token: z
    .string()
    .describe(
      "The key, shown ONCE. Only its hash is kept, so it cannot be retrieved later — losing it means revoking and creating a new source.",
    ),
});

// -----------------------------------------------------------------------------
// source_revoke
// -----------------------------------------------------------------------------

export const sourceRevokeParamsSchema = campaignParamsSchema.extend({
  id: z.string().describe("The source id, from `source_list`."),
});

export const sourceRevokeResultSchema = z.object({
  id: z.string(),
  revokedAt: z.string(),
});
