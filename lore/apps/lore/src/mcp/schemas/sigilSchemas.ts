import { z } from "alepha";
import { APP_NAME_MAX_LENGTH } from "../../api/schemas/appNameSchema.ts";
import { projectParamsSchema } from "./commonSchemas.ts";

/**
 * One enrolled app.
 *
 * `tokenPrefix` is the only part of the credential that survives creation, and
 * it exists so a sigil can be named in conversation without being usable.
 */
const sigilSchema = z.object({
  id: z.string(),
  projectId: z.integer(),
  /** Display name of the app, e.g. `lore`. Unique within the project. */
  name: z.string(),
  /** First characters of the token — enough to name it, not to use it. */
  tokenPrefix: z.string(),
  /** Capability buckets this sigil's ingest endpoint accepts. */
  kinds: z.array(z.string()),
  createdAt: z.string(),
  /** Last time this app reported anything. Absent means never. */
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
  // The bound is imported rather than restated: the server enforces
  // `appNameSchema` on the way in, and a description that promises more than
  // the handler accepts costs the caller a 400 it cannot see coming.
  name: z
    .string()
    .min(1)
    .max(APP_NAME_MAX_LENGTH)
    .describe(
      `A slug, not a title: lowercase letters, digits and interior hyphens only (\`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$\`), at most ${APP_NAME_MAX_LENGTH} characters — it becomes the app's URL segment, e.g. \`lore-staging\` for /p/2/apps/lore-staging. Leading and trailing whitespace is trimmed and capitals are lowercased, so \`Lore-Staging\` is accepted and stored as \`lore-staging\`; a space, an underscore or any other character is rejected outright. Unique within the project — everything this sigil reports is filed under it. How finely to slice is the operator's call: an app that wants its staging traffic kept apart from production enrolls two sigils and names them so.`,
    ),
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
