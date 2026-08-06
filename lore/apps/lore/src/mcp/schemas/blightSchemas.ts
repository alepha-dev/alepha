import { z } from "alepha";
import { projectParamsSchema } from "./commonSchemas.ts";

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
  /** Which app reported it last — see `sigils` in the same result. */
  sigilId: z.string().optional(),
  fingerprint: z.string(),
  name: z.string(),
  message: z.string(),
  stack: z.string(),
  sourceUrl: z.string(),
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

export const blightListParamsSchema = projectParamsSchema.extend({
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
  /** The apps that report here, for reading `sigilId` back to a name. */
  sigils: z.array(
    z.object({
      id: z.string(),
      /**
       * The sigil's display name — carries `sigil.name`. The wire field
       * stays `label` deliberately: this surface predates the sigil
       * reshape (app + environment + label collapsed into one `name`),
       * and renaming the field would break every existing MCP client
       * reading `blight_list`. `sigil_list` reports the identical string
       * as `name` — same value, two field names, one per tool.
       */
      label: z.string(),
    }),
  ),
});

// -----------------------------------------------------------------------------
// blight_resolve
// -----------------------------------------------------------------------------

export const blightResolveParamsSchema = projectParamsSchema.extend({
  blight_id: z.integer().describe("The blight id, from `blight_list`."),
});

export const blightResolveResultSchema = z.object({ ok: z.boolean() });

// -----------------------------------------------------------------------------
// blight_forward
// -----------------------------------------------------------------------------

export const blightForwardParamsSchema = projectParamsSchema.extend({
  blight_id: z.integer().describe("The blight id, from `blight_list`."),
});

export const blightForwardResultSchema = z.object({
  questId: z.integer(),
  questShortId: z.integer(),
});
