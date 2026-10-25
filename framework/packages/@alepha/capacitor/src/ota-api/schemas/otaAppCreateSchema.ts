import { type Infer, z } from "alepha";

/**
 * Register an app: its bundle identifier and the publisher's public key
 * (PKCS#1 PEM), never the private one.
 */
export const otaAppCreateSchema = z.object({
  appId: z.text({ pattern: /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/ }),
  name: z.text({ maxLength: 100 }),
  publicKey: z.text({ maxLength: 4096 }),
  defaultChannel: z
    .text({ maxLength: 64, pattern: /^[a-z0-9][a-z0-9-]*$/ })
    .optional(),
});

export type OtaAppCreate = Infer<typeof otaAppCreateSchema>;
