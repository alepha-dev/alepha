import { $env, $hook, $inject, Alepha, AlephaError, z } from "alepha";
import { $logger } from "alepha/logger";

export const DEFAULT_SECRET_KEY_VALUE = "change-me-in-production";

export const alephaSecretEnvSchema = z.object({
  APP_SECRET: z.text({
    default: DEFAULT_SECRET_KEY_VALUE,
    description:
      "The secret key used for signing JWTs, encrypting cookies, and other security features.",
  }),
});

export class SecretProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly env = $env(alephaSecretEnvSchema);

  public get secretKey(): string {
    return this.env.APP_SECRET;
  }

  protected readonly configure = $hook({
    on: "configure",
    handler: async () => {
      if (this.secretKey === DEFAULT_SECRET_KEY_VALUE) {
        // In production the default secret is a full token-forgery bypass:
        // JWTs would be signed with a public, well-known constant. Fail closed.
        if (this.alepha.isProduction()) {
          throw new AlephaError(
            "APP_SECRET is unset in production (using the built-in default). " +
              "Set a strong, unique APP_SECRET environment variable — the default " +
              "is public and lets anyone forge authentication tokens.",
          );
        }
        // Outside production, keep the convenience default but make the risk loud.
        this.log.warn(
          "Using the default APP_SECRET. This is fine for local development but " +
            "MUST be set to a strong, unique value before deploying to production.",
        );
      }
    },
  });
}
