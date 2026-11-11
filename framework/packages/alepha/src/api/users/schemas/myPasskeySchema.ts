import { type Infer, z } from "alepha";

/**
 * One of the caller's passkeys, as the account page lists it. Never the
 * public key.
 */
export const myPasskeySchema = z.object({
  id: z.uuid(),
  name: z.text({ size: "short" }),
  createdAt: z.datetime(),
  lastUsedAt: z.datetime().optional(),
  backedUp: z
    .boolean()
    .describe("Synced to the user's other devices (a synced passkey)."),
  usable: z
    .boolean()
    .describe(
      "Signs in here: the realm offers passkeys and the passkey was made for this host.",
    ),
});

export type MyPasskey = Infer<typeof myPasskeySchema>;
