import { $env, $hook, $inject, Alepha, t } from "alepha";
import { $logger } from "alepha/logger";

export const DEFAULT_SECRET_KEY_VALUE = "change-me-in-production";

export const alephaSecretEnvSchema = t.object({
  APP_SECRET: t.text({
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
      if (
        this.secretKey === DEFAULT_SECRET_KEY_VALUE &&
        this.alepha.isProduction()
      ) {
        this.log.warn(
          "Using default secret key. Please set a secure APP_SECRET environment variable.",
        );
      }
    },
  });
}
