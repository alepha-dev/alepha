import { type Infer, z } from "alepha";

import { otaUpdateAvailableSchema } from "./otaUpdateAvailableSchema.ts";
import { otaUpdateBuiltinSchema } from "./otaUpdateBuiltinSchema.ts";
import { otaUpdateErrorSchema } from "./otaUpdateErrorSchema.ts";
import { otaUpdateNoneSchema } from "./otaUpdateNoneSchema.ts";

/**
 * Every answer `POST /ota/updates` gives. The builtin reset comes first: its
 * `version` is a literal the available shape would also accept.
 */
export const otaUpdateResponseSchema = z.union([
  otaUpdateBuiltinSchema,
  otaUpdateAvailableSchema,
  otaUpdateNoneSchema,
  otaUpdateErrorSchema,
]);

export type OtaUpdateResponse = Infer<typeof otaUpdateResponseSchema>;
