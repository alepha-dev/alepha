import { z } from "alepha";
import { projectParamsSchema } from "./commonSchemas.ts";

/**
 * One enrolled environment.
 *
 * `tokenPrefix` is the only part of the credential that survives creation, and
 * it exists so a sigil can be named in conversation without being usable.
 */
const sigilSchema = z.object({
  id: z.string(),
  projectId: z.integer(),
  /** Application name, e.g. `lore`. */
  app: z.string(),
  /** Stage, e.g. `production`. */
  environment: z.string(),
  label: z.string(),
  /** First characters of the token — enough to name it, not to use it. */
  tokenPrefix: z.string(),
  /** Capability buckets this sigil's ingest endpoint accepts. */
  kinds: z.array(z.string()),
  createdAt: z.string(),
  /** Last time this environment reported anything. Absent means never. */
  lastSeenAt: z.string().optional(),
});

/**
 * A sigil plus the one cleartext copy of its token that will ever exist.
 *
 * Returned by `sigil_create` and `sigil_rotate` only. It is stored hashed, so
 * nothing — not this tool, not the web UI, not the database — can produce it a
 * second time.
 */
const mintedSigilSchema = sigilSchema.extend({
  token: z
    .string()
    .describe(
      "The bearer token, shown once and never retrievable again. Hand it to the app's operator; do not repeat it into logs or notes.",
    ),
});

// -----------------------------------------------------------------------------
// sigil_list
// -----------------------------------------------------------------------------

export const sigilListParamsSchema = projectParamsSchema;

export const sigilListResultSchema = z.object({
  sigils: z.array(sigilSchema),
});

// -----------------------------------------------------------------------------
// sigil_create
// -----------------------------------------------------------------------------

export const sigilCreateParamsSchema = projectParamsSchema.extend({
  app: z
    .string()
    .min(1)
    .max(100)
    .describe("Application name, e.g. `lore`. Free-form."),
  environment: z
    .string()
    .min(1)
    .max(50)
    .describe(
      "Stage, e.g. `production` or `staging`. One sigil per app per environment — they report separately on purpose.",
    ),
  label: z
    .string()
    .min(1)
    .max(200)
    .describe("Display name. Defaults to `<app> / <environment>`.")
    .optional(),
});

export const sigilCreateResultSchema = mintedSigilSchema;

// -----------------------------------------------------------------------------
// sigil_rotate
// -----------------------------------------------------------------------------

export const sigilRotateParamsSchema = projectParamsSchema.extend({
  id: z.string().describe("The sigil id, from `sigil_list`."),
});

export const sigilRotateResultSchema = mintedSigilSchema;

// -----------------------------------------------------------------------------
// sigil_delete
// -----------------------------------------------------------------------------

export const sigilDeleteParamsSchema = projectParamsSchema.extend({
  id: z.string().describe("The sigil id, from `sigil_list`."),
});

export const sigilDeleteResultSchema = z.object({ ok: z.boolean() });
