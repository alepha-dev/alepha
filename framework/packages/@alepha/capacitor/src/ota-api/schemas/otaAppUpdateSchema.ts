import { type Infer, z } from "alepha";

/**
 * Change an app: its name, its publisher key (a key rotation, with a new
 * binary carrying the new public key), its default channel, or the API keys
 * allowed to publish to it.
 */
export const otaAppUpdateSchema = z.object({
  name: z.text({ maxLength: 100 }).optional(),
  publicKey: z.text({ maxLength: 4096 }).optional(),
  defaultChannel: z.text({ maxLength: 64 }).optional(),
  publisherKeyIds: z.array(z.uuid()).max(20).optional(),
});

export type OtaAppUpdate = Infer<typeof otaAppUpdateSchema>;
