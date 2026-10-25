import { type Infer, z } from "alepha";

/**
 * Open a channel to devices assigning themselves, or close it.
 */
export const otaChannelUpdateSchema = z.object({
  allowSelfAssign: z.boolean(),
});

export type OtaChannelUpdate = Infer<typeof otaChannelUpdateSchema>;
