import { type Infer, z } from "alepha";

/**
 * What a publish answers: the bundle, where it went, and whether this call
 * created it or found it already published (a retried upload).
 */
export const otaPublishResultSchema = z.object({
  id: z.uuid(),
  version: z.text({ maxLength: 128 }),
  platform: z.enum(["ios", "android"]),
  channel: z.text({ maxLength: 64 }),
  created: z.boolean(),
});

export type OtaPublishResult = Infer<typeof otaPublishResultSchema>;
