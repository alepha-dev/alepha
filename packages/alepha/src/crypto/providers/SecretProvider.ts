import { $env, $hook, $inject, Alepha, AlephaError, z } from "alepha";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";

import { CryptoProvider } from "./CryptoProvider.ts";

export const DEFAULT_SECRET_KEY_VALUE = "change-me-in-production";

export const alephaSecretEnvSchema = z.object({
  APP_SECRET: z.text({
    default: DEFAULT_SECRET_KEY_VALUE,
    description:
      "The secret key used for signing JWTs, encrypting cookies, and other security features.",
  }),
  APP_SECRET_FILE: z
    .text({
      description:
        "Path to a file holding APP_SECRET. Read on boot, and generated on first boot when the file does not exist. For self-hosted images, which cannot ship a baked secret.",
    })
    .optional(),
});

export class SecretProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly env = $env(alephaSecretEnvSchema);

  /**
   * Secret read or generated from {@link alephaSecretEnvSchema APP_SECRET_FILE}.
   *
   * A field the getter prefers, rather than a write-back into the parsed env:
   * `$env` results are inputs and stay immutable, since other providers may
   * already hold a reference and anything re-parsing would silently disagree
   * with a mutated copy.
   */
  protected resolvedSecret?: string;

  public get secretKey(): string {
    return this.resolvedSecret ?? this.env.APP_SECRET;
  }

  protected readonly configure = $hook({
    on: "configure",
    handler: async () => {
      await this.resolveSecretFromFile();

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

  /**
   * Read the secret from `APP_SECRET_FILE`, generating and persisting one on
   * first boot.
   *
   * This is what lets a public image run with no environment at all: a baked
   * constant would be one token-forgery key shared by every install on earth,
   * and demanding an `APP_SECRET` would break the one-line `docker run`. Same
   * shape as Gitea and Grafana.
   *
   * Runs on `configure`, the earliest hook there is. Nothing reads
   * `secretKey` from another `configure` hook, so the resolved value is in
   * place before any consumer. The one earlier read in the tree is
   * `SecurityProvider.realms`, a class-field initializer gated on
   * `isTest()` — a container is not a test, and a test has no business
   * pointing `APP_SECRET_FILE` at anything.
   */
  protected async resolveSecretFromFile(): Promise<void> {
    const path = this.env.APP_SECRET_FILE;
    if (!path) {
      // Nothing about the existing behaviour changes when unset: the
      // production guard below is what stops a cloud deploy shipping on the
      // public default, and every existing Alepha deploy relies on it.
      return;
    }

    // An explicit APP_SECRET always wins, and short-circuits before the
    // serverless refusal: a Worker that already carries its own secret is
    // correctly configured, whatever else the shared env happens to say.
    if (this.env.APP_SECRET !== DEFAULT_SECRET_KEY_VALUE) {
      return;
    }

    if (this.alepha.isServerless()) {
      // Refused rather than ignored. A silent no-op here would leave the
      // Worker booting on the public default, which is the exact outcome
      // this whole path exists to prevent.
      throw new AlephaError(
        `APP_SECRET_FILE is set to '${path}', but serverless runtimes have no writable filesystem. ` +
          "Set APP_SECRET directly as a secret instead.",
      );
    }

    if (await this.fs.exists(path)) {
      const stored = (await this.fs.readTextFile(path)).trim();
      if (stored) {
        // Used verbatim, and nothing is rewritten. A file holding the public
        // default is deliberately NOT special-cased: the guard below fires on
        // it, which is the right answer.
        this.resolvedSecret = stored;
        return;
      }
      this.log.warn(
        `APP_SECRET_FILE '${path}' is empty. Generating a new secret.`,
      );
    }

    // 64 base64url characters out of 64 random bytes. Long enough that it can
    // never collide with DEFAULT_SECRET_KEY_VALUE and trip the guard on a
    // secret we just wrote.
    const generated = this.crypto.randomText(64);

    try {
      // 0600, because a world-readable signing key on a shared host is the
      // same hole in a different place. Creation-time only, which is all
      // that is needed: this branch runs when the file does not exist.
      await this.fs.writeFile(path, generated, { mode: 0o600 });
    } catch (cause) {
      throw new AlephaError(
        `APP_SECRET_FILE '${path}' could not be written. The directory must exist and be writable by the user the process runs as.`,
        { cause },
      );
    }

    this.resolvedSecret = generated;
    // Never the value itself — the operator only needs to know a new install
    // minted one, and that a restart will reuse it.
    this.log.info(`Generated a new APP_SECRET and stored it in '${path}'.`);
  }
}
