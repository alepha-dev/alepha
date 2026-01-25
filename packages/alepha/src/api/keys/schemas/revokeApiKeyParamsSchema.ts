import { t } from "alepha";

export const revokeApiKeyParamsSchema = t.object({
  id: t.uuid(),
});
