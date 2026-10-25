import { type Infer, z } from "alepha";

/**
 * A published bundle as the admin sees it: what it runs on, its three
 * digests kept apart, and its state.
 */
export const otaBundleResourceSchema = z.object({
  id: z.uuid(),
  appRef: z.uuid(),
  platform: z.enum(["ios", "android"]),
  variant: z.text({ maxLength: 64 }),
  version: z.text({ maxLength: 128 }),
  channel: z.text({ maxLength: 64 }),
  builds: z.array(z.text({ maxLength: 64 })),
  fingerprint: z.text({ maxLength: 128 }),
  keyId: z.text({ maxLength: 64 }),
  archiveSha256: z.text({ maxLength: 64 }),
  ciphertextSha256: z.text({ maxLength: 64 }),
  size: z.integer(),
  expandedSize: z.integer(),
  files: z.integer(),
  status: z.enum(["uploading", "ready", "failed", "deleted"]),
  killedAt: z.datetime().optional(),
  killedReason: z.text().optional(),
  createdAt: z.datetime(),
});

export type OtaBundleResource = Infer<typeof otaBundleResourceSchema>;
