import { type Infer, z } from "alepha";

/**
 * A live update app as the admin sees it.
 */
export const otaAppResourceSchema = z.object({
  id: z.uuid(),
  appId: z.text(),
  name: z.text({ maxLength: 100 }),
  publicKey: z.text({ size: "long" }),
  keyId: z.text({ maxLength: 64 }),
  defaultChannel: z.text({ maxLength: 64 }),
  publisherKeyIds: z.array(z.uuid()),
  createdAt: z.datetime(),
});

export type OtaAppResource = Infer<typeof otaAppResourceSchema>;
