import { z } from "alepha";

import { APP_NAME_MAX_LENGTH } from "../../api/schemas/appNameSchema.ts";
import { artifactGroupSchema } from "../../api/schemas/artifactGroupSchema.ts";
import { RELEASE_TAG_MAX_LENGTH } from "../../api/schemas/releaseTagSchema.ts";
import { projectParamsSchema } from "./projectParamsSchema.ts";

/**
 * The bounds are imported rather than restated: the server enforces them on the
 * way in, and a description promising more than the handler accepts costs the
 * caller a 400 it cannot see coming.
 */
const appParam = z
  .string()
  .min(1)
  .max(APP_NAME_MAX_LENGTH)
  .describe(
    "The app the build came from, as a slug: lowercase letters, digits and interior hyphens. Matches an enrolled app's name when the project has one, but an artifact does not require a sigil.",
  );

const tagParam = z
  .string()
  .min(1)
  .max(RELEASE_TAG_MAX_LENGTH)
  .describe(
    "The version the build is named by. CASE-SENSITIVE, because it is the join key to a release's tag and CI derives both from a git tag byte for byte: `RC1` and `rc1` are different tags.",
  );

// -----------------------------------------------------------------------------
// artifact_list
// -----------------------------------------------------------------------------

export const artifactListParamsSchema = projectParamsSchema.extend({
  app: appParam.optional(),
  tag: tagParam
    .describe(
      "Narrow to one tag. This is how you check whether a release's builds exist: the join is tag equality, so a release `0.28.0` and an artifact tagged `0.28.0` are the same fact stated twice.",
    )
    .optional(),
  limit: z
    .integer()
    .min(1)
    .max(500)
    .describe(
      "How many ROWS to read before grouping, not how many entries come back: a tag with a node build and a workerd build is two rows and one entry. Defaults to 200.",
    )
    .optional(),
});

export const artifactListResultSchema = z.object({
  artifacts: z.array(artifactGroupSchema),
  truncated: z
    .boolean()
    .describe(
      "True when the row cap was reached, so more artifacts exist than are listed. Narrow with `app` or `tag`; there is no page 2, because paging over rows would split one tag's variants across two pages and each page would then claim to be the whole release.",
    ),
});

// -----------------------------------------------------------------------------
// artifact_get
// -----------------------------------------------------------------------------

export const artifactGetParamsSchema = projectParamsSchema.extend({
  app: appParam,
  tag: tagParam,
  runtime: z
    .string()
    .min(1)
    .max(32)
    .describe(
      "Narrow to one build: `node`, `bun`, `workerd` or `static`. Omit to get every runtime under this tag, which is usually what you want - a tag names one release, and its variants are the same release built twice.",
    )
    .optional(),
});

export const artifactGetResultSchema = z.object({
  artifact: artifactGroupSchema,
});
