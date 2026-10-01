import { $atom, $store, type Infer } from "alepha";

import {
  type VerificationSettings,
  verificationSettingsSchema,
} from "../schemas/verificationSettingsSchema.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Verification settings configuration atom
 */
export const verificationOptions = $atom({
  name: "alepha.api.verifications.options",
  schema: verificationSettingsSchema,
  default: {
    code: {
      maxAttempts: 5,
      codeLength: 6,
      codeExpiration: 300, // 5 minutes
      verificationCooldown: 90,
      limitPerDay: 10,
    },
    link: {
      maxAttempts: 3, // Lower since UUIDs are harder to guess
      codeExpiration: 1800, // 30 minutes
      verificationCooldown: 90,
      limitPerDay: 10,
    },
    purgeDays: 1,
  },
  serverOnly: true,
});

export type VerificationOptions = Infer<typeof verificationOptions.schema>;

declare module "alepha" {
  interface State {
    [verificationOptions.key]: VerificationOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export class VerificationParameters {
  protected readonly options = $store(verificationOptions);

  public get<K extends keyof VerificationSettings>(
    key: K,
  ): VerificationSettings[K] {
    return this.options[key];
  }
}
