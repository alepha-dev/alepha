import { z } from "alepha";

/**
 * An app's settings.
 */
export const otaSettingsFormSchema = z.object({
  name: z.text({ maxLength: 100 }),
  defaultChannel: z.text({ maxLength: 64 }),
  publisherKeyIds: z.array(z.text()),
  publicKey: z.text({ maxLength: 4096 }),
});
