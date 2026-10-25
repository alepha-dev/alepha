import { type Infer, z } from "alepha";

/**
 * A new channel. Private unless `allowSelfAssign`.
 */
export const otaChannelCreateSchema = z.object({
  appRef: z.uuid(),
  name: z.text({ maxLength: 64, pattern: /^[a-z0-9][a-z0-9-]*$/ }),
  allowSelfAssign: z.boolean().optional(),
});

export type OtaChannelCreate = Infer<typeof otaChannelCreateSchema>;
