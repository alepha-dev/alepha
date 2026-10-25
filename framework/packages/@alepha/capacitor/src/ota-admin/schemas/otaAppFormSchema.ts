import { z } from "alepha";

/**
 * Registering an app: its bundle id, a name, the publisher's public key.
 */
export const otaAppFormSchema = z.object({
  appId: z.text(),
  name: z.text({ maxLength: 100 }),
  publicKey: z.text({ maxLength: 4096 }),
});
