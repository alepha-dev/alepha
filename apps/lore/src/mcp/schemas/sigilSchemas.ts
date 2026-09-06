import { z } from "alepha";

import { appInstances } from "../../api/entities/appInstances.ts";
import { APP_NAME_MAX_LENGTH } from "../../api/schemas/appNameSchema.ts";
import { sigilResourceSchema } from "../../api/schemas/sigilResourceSchema.ts";
import { projectParamsSchema } from "./projectParamsSchema.ts";

/**
 * One credential, and the deployed copy it belongs to.
 *
 * `tokenPrefix` is the only part of the credential that survives creation, and
 * it exists so a sigil can be named in conversation without being usable.
 *
 * ⚠️ `app` and `env` are the identity now; `name` is a server-written mirror of
 * `"<app>/<env>"` that nothing may set. It is kept because it is what the
 * blights filter and the insights dimension render, and because a tool result
 * losing a field is a silent break at the far end.
 */
const sigilSchema = sigilResourceSchema
  .pick({
    id: true,
    projectId: true,
    name: true,
    tokenPrefix: true,
    kinds: true,
    createdAt: true,
    lastSeenAt: true,
  })
  .extend({
    app: appInstances.schema.shape.app.describe(
      "The app this credential's instance is a copy of.",
    ),
    env: appInstances.schema.shape.env.describe(
      "Which copy. Free text; nothing parses it.",
    ),
    name: sigilResourceSchema.shape.name.describe(
      'DERIVED: `"<app>/<env>"`, written by the server and never an input. Read it as a label, not as an identity.',
    ),
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
  app: z
    .string()
    .min(1)
    .max(APP_NAME_MAX_LENGTH)
    .optional()
    .describe(
      `Which app to mint for. A slug, not a title: lowercase letters, digits and interior hyphens only (\`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$\`), at most ${APP_NAME_MAX_LENGTH} characters. Trimmed and lowercased, so \`Club\` is accepted and stored as \`club\`. Required in practice — it is optional here only so the deprecated \`name\` can stand in for it.`,
    ),
  env: z
    .string()
    .min(1)
    .max(APP_NAME_MAX_LENGTH)
    .optional()
    .describe(
      "Which copy to mint for, e.g. `staging`. Same charset as `app`. Defaults to `production`, which is the one place a default is safe: this tool creates the instance when it is missing, so the default names a copy rather than guessing among several.",
    ),
  name: z
    .string()
    .min(1)
    .max(APP_NAME_MAX_LENGTH)
    .optional()
    .describe(
      "DEPRECATED alias of `app`, kept so saved instructions keep working. Pass `app` instead.",
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
