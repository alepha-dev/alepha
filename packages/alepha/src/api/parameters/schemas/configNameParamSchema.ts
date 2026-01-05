import { t } from "alepha";

/**
 * Config name param schema.
 */
export const configNameParamSchema = t.object({
  name: t.text({
    description: "Configuration name (e.g., app.features.flags)",
  }),
});
