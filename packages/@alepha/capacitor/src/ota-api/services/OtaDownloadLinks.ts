import { $env, $inject, $store, Alepha, AlephaError, z } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";

import { otaApiOptions } from "../atoms/otaApiOptions.ts";
import type { OtaBundleEntity } from "../entities/otaBundles.ts";

const envSchema = z.object({
  OTA_DOWNLOAD_SECRET: z
    .text({
      description:
        "Server-only secret signing the short-lived OTA download links. Required in production. Never the signing key of the publisher.",
    })
    .optional(),
});

/**
 * Short-lived download links for bundles: `/ota/bundles/:id/download?token=`.
 *
 * The pinned updater fetches a bundle's `url` bare, with no header of ours,
 * so the link carries its own proof: an HMAC over the bundle id, its app,
 * its ciphertext digest and an expiry, ten minutes by default, keyed by
 * `OTA_DOWNLOAD_SECRET`. Checked in constant time. The parameter is named
 * `token` so the server's request log redacts it.
 *
 * Delivery protection, not secrecy: a public channel's update endpoint hands
 * a link to any device that asks, and every installed app can decrypt a
 * bundle anyway.
 */
export class OtaDownloadLinks {
  protected static readonly DEVELOPMENT_SECRET = "alepha-ota-development-only";

  protected readonly env = $env(envSchema);
  protected readonly alepha = $inject(Alepha);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly options = $store(otaApiOptions);
  protected readonly log = $logger();
  protected warned = false;

  /**
   * A link for this bundle under `origin`, and when it expires.
   */
  public create(
    bundle: Pick<OtaBundleEntity, "id" | "appRef" | "ciphertextSha256">,
    origin: string,
  ): { url: string; expiresAt: number } {
    if (this.alepha.isProduction() && !origin.startsWith("https://")) {
      throw new AlephaError(
        `OTA download links must be HTTPS in production, and this server's public origin is ${origin}. Set PUBLIC_URL, or forward the protocol from the proxy.`,
      );
    }
    const expiresAt =
      this.dateTime.nowMillis() + this.options.linkTtlSeconds * 1000;
    const token = `${expiresAt}.${this.sign(bundle, expiresAt)}`;
    return {
      url: `${origin.replace(/\/$/, "")}/ota/bundles/${bundle.id}/download?token=${token}`,
      expiresAt,
    };
  }

  /**
   * Whether `token` is a live link to this bundle.
   */
  public verify(
    bundle: Pick<OtaBundleEntity, "id" | "appRef" | "ciphertextSha256">,
    token: string,
  ): boolean {
    const dot = token.indexOf(".");
    if (dot < 1) {
      return false;
    }
    const expiresAt = Number(token.slice(0, dot));
    if (!Number.isSafeInteger(expiresAt)) {
      return false;
    }
    const valid = this.crypto.equals(
      this.sign(bundle, expiresAt),
      token.slice(dot + 1),
    );
    return valid && expiresAt > this.dateTime.nowMillis();
  }

  protected sign(
    bundle: Pick<OtaBundleEntity, "id" | "appRef" | "ciphertextSha256">,
    expiresAt: number,
  ): string {
    return this.crypto.hmac(
      `${bundle.id}:${bundle.appRef}:${bundle.ciphertextSha256}:${expiresAt}`,
      this.secret(),
    );
  }

  protected secret(): string {
    const secret = this.env.OTA_DOWNLOAD_SECRET;
    if (secret) {
      return secret;
    }
    if (this.alepha.isProduction()) {
      throw new AlephaError(
        "OTA_DOWNLOAD_SECRET is not set: live update download links cannot be signed.",
      );
    }
    if (!this.warned) {
      this.warned = true;
      this.log.warn(
        "OTA_DOWNLOAD_SECRET is not set; signing download links with a development-only secret.",
      );
    }
    return OtaDownloadLinks.DEVELOPMENT_SECRET;
  }
}
