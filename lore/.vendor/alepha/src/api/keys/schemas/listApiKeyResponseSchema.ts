import { z } from "alepha";

import { listApiKeyItemSchema } from "./listApiKeyItemSchema.ts";

export const listApiKeyResponseSchema = z.array(listApiKeyItemSchema);
