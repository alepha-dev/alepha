import { t } from "alepha";

/**
 * Config name and version param schema.
 */
export const configVersionParamSchema = t.object({
  name: t.text(),
  version: t.integer(),
});
