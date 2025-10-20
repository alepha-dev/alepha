import type { Configurable } from "@alepha/core";
import type { VerificationSettings } from "../schemas/verificationSettingsSchema.ts";

export class VerificationParameters
  implements Configurable<VerificationSettings>
{
  public options = {
    phone: {
      maxAttempts: 5,
      codeLength: 6,
      codeExpiration: 300, // 5 minutes
      verificationCooldown: 90,
      limitPerDay: 10,
    },
    email: {
      maxAttempts: 3, // Lower since UUIDs are harder to guess
      codeExpiration: 1800, // 30 minutes
      verificationCooldown: 90,
      limitPerDay: 10,
    },
    purgeDays: 1,
  };

  public get<K extends keyof VerificationSettings>(
    key: K,
  ): VerificationSettings[K] {
    return this.options[key];
  }
}
