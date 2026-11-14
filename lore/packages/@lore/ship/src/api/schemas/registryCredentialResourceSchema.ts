import type { Infer } from "alepha";

import { registryCredentials } from "../entities/registryCredentials.ts";

/**
 * A registry credential as every response shows it: the host and the
 * username, never the secret. A `pick` allowlist, so a column added later
 * cannot ride along.
 */
export const registryCredentialResourceSchema = registryCredentials.schema.pick(
  {
    id: true,
    host: true,
    username: true,
    updatedAt: true,
    updatedBy: true,
  },
);

export type RegistryCredentialResource = Infer<
  typeof registryCredentialResourceSchema
>;
