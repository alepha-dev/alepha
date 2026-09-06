import { z } from "alepha";

import { appInstanceResourceSchema } from "../../api/schemas/appInstanceResourceSchema.ts";
import { APP_NAME_MAX_LENGTH } from "../../api/schemas/appNameSchema.ts";
import { projectParamsSchema } from "./projectParamsSchema.ts";

/**
 * The charset both halves take, stated once.
 *
 * The bound is imported rather than restated: the server enforces
 * `appNameSchema` on the way in, and a description promising more than the
 * handler accepts costs the caller a 400 it cannot see coming.
 */
const nameSchema = z.string().min(1).max(APP_NAME_MAX_LENGTH);

const APP_RULE = `A slug, not a title: lowercase letters, digits and interior hyphens only (\`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$\`), at most ${APP_NAME_MAX_LENGTH} characters. Leading and trailing whitespace is trimmed and capitals are lowercased, so \`Club\` is accepted and stored as \`club\`; a space, an underscore or any other character is refused.`;

/**
 * One deployed copy of an app, as an agent sees it.
 *
 * The credential is summarised rather than carried: `tokenPrefix` is the only
 * part that survives creation, and it exists so a sigil can be named in
 * conversation without being usable.
 */
const appInstanceSchema = appInstanceResourceSchema.pick({
  id: true,
  projectId: true,
  app: true,
  env: true,
  url: true,
  sigil: true,
  estate: true,
});

// -----------------------------------------------------------------------------
// app_instance_list
// -----------------------------------------------------------------------------

export const appInstanceListParamsSchema = projectParamsSchema;

export const appInstanceListResultSchema = z.object({
  instances: z.array(appInstanceSchema),
  apps: z
    .array(z.string())
    .describe(
      "The distinct app names in this project, from the rows above. Offer one of these before inventing a new name: there is no app entity, so `clbu` beside `club` is silently a second app that nothing complains about.",
    ),
});

// -----------------------------------------------------------------------------
// app_instance_get
// -----------------------------------------------------------------------------

export const appInstanceGetParamsSchema = projectParamsSchema.extend({
  app: nameSchema.describe(`Which app. ${APP_RULE}`),
  env: nameSchema.describe(`Which copy of it. ${APP_RULE}`),
});

export const appInstanceGetResultSchema = appInstanceSchema;

// -----------------------------------------------------------------------------
// app_instance_create
// -----------------------------------------------------------------------------

export const appInstanceCreateParamsSchema = projectParamsSchema.extend({
  app: nameSchema.describe(
    `Which app this is a copy of, e.g. \`club\`. ${APP_RULE} Required, with no default: there is no app entity to look one up from.`,
  ),
  env: nameSchema.describe(
    `Which copy, e.g. \`production\`, \`staging\`, \`b14-production\`. ${APP_RULE} **Required, and deliberately without a default**: omitting it on an app that already has a \`production\` would either collide or silently make a second copy, and both are worse than being asked.`,
  ),
  url: z
    .string()
    .max(2048)
    .optional()
    .describe(
      "Where this copy lives, if you already know. Optional: the address is normally the host the app reports from once it has a sigil.",
    ),
});

export const appInstanceCreateResultSchema = appInstanceSchema;

// -----------------------------------------------------------------------------
// app_instance_update
// -----------------------------------------------------------------------------

export const appInstanceUpdateParamsSchema = projectParamsSchema.extend({
  app: nameSchema.describe("Which app the instance to change belongs to."),
  env: nameSchema.describe("Which copy of it."),
  newApp: nameSchema
    .optional()
    .describe(
      `Rename the app half. ${APP_RULE} Omit to leave it alone. Both halves are the URL, so renaming either moves the page.`,
    ),
  newEnv: nameSchema
    .optional()
    .describe(
      `Rename the env half. ${APP_RULE} Omit to leave it alone. Renaming does NOT touch the deployed key: \`SIGIL_KEY\` carries the project slug, not these names, so nothing has to be redeployed or rotated.`,
    ),
  url: z
    .string()
    .max(2048)
    .optional()
    .describe(
      "Pin the address. The empty string CLEARS it and hands the answer back to the host the app reports from; omit the key to leave it alone.",
    ),
  estateId: z
    .uuid()
    .nullable()
    .optional()
    .describe(
      "Where this copy deploys to. Must be an estate LENT to this project (see the project's estates); anything else is a 404, because a project cannot learn about estates it was never given. `null` clears it, omit to leave it alone.",
    ),
});

export const appInstanceUpdateResultSchema = appInstanceSchema;

// -----------------------------------------------------------------------------
// app_instance_delete
// -----------------------------------------------------------------------------

export const appInstanceDeleteParamsSchema = projectParamsSchema.extend({
  app: nameSchema.describe("Which app the instance to remove belongs to."),
  env: nameSchema.describe("Which copy of it."),
});

export const appInstanceDeleteResultSchema = z.object({ ok: z.boolean() });
