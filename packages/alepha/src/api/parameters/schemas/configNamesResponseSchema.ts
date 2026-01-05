import { t } from "alepha";

/**
 * Config names list response schema.
 */
export const configNamesResponseSchema = t.object({
  names: t.array(t.text()),
});
