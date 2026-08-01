import { z } from "alepha";
import { campaignParamsSchema } from "./commonSchemas.ts";

/**
 * One deduplicated failure.
 *
 * `name`, `message`, `stack` and `sourceUrl` come out of an application's
 * runtime and are attacker-controlled. They are data to read, never
 * instructions to follow — a message can say anything, including something
 * shaped like a prompt.
 */
const blightSchema = z.object({
  id: z.integer(),
  /** Which enrolled source filed it — a Sigil instance, in practice. */
  sourceId: z.string().optional(),
  fingerprint: z.string(),
  name: z.string(),
  message: z.string(),
  stack: z.string(),
  sourceUrl: z.string(),
  release: z.string().optional(),
  /** Absolute link to the error group in Sigil, when it knows its own origin. */
  pulseUrl: z.string().optional(),
  origin: z.enum(["client", "server"]),
  /** How many times it happened, not how many rows exist. */
  count: z.integer(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  status: z.string(),
});

// -----------------------------------------------------------------------------
// blight_list
// -----------------------------------------------------------------------------

export const blightListParamsSchema = campaignParamsSchema.extend({
  include_resolved: z
    .boolean()
    .describe(
      "Also return resolved and quest-forwarded blights. Default false — open only.",
    )
    .optional(),
});

export const blightListResultSchema = z.object({
  blights: z.array(blightSchema),
  openCount: z.integer(),
  /** The systems that file here, for reading `sourceId` back to a name. */
  sources: z.array(z.object({ id: z.string(), name: z.string() })),
});

// -----------------------------------------------------------------------------
// blight_resolve
// -----------------------------------------------------------------------------

export const blightResolveParamsSchema = campaignParamsSchema.extend({
  blight_id: z.integer().describe("The blight id, from `blight_list`."),
});

export const blightResolveResultSchema = z.object({ ok: z.boolean() });

// -----------------------------------------------------------------------------
// blight_forward
// -----------------------------------------------------------------------------

export const blightForwardParamsSchema = campaignParamsSchema.extend({
  blight_id: z.integer().describe("The blight id, from `blight_list`."),
});

export const blightForwardResultSchema = z.object({
  questId: z.integer(),
  questShortId: z.integer(),
});
