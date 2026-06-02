import { $inject, AlephaError, t } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $action } from "alepha/server";
import { sigilIngestEnvelope } from "../shared/schemas/sigilIngestEnvelope.ts";
import { sigilPetitionFields } from "../shared/schemas/sigilPetition.ts";
import { SigilForwardProvider } from "./SigilForwardProvider.ts";

/**
 * Same-origin proxy controller that the browser calls.
 *
 * Stamps server-derived fields (`country`, `visitor`) onto ingest envelopes
 * before forwarding to Lore, and proxies petition multipart submissions.
 * Two endpoints:
 *
 * - `POST /api/sigil/ingest` — telemetry envelope (views, errors, vitals).
 * - `POST /api/sigil/petition` — petition multipart form + screenshot file.
 *
 * The `visitor` hash is a daily-stable, non-reversible fingerprint:
 * `sha256(sigilId + ":" + ip + ":" + userAgent + ":" + dailySalt)` where
 * `dailySalt = sha256((SIGIL_IP_SALT ?? "lore-sigil") + ":" + utcDate)`.
 * The raw IP is never forwarded or stored.
 *
 * NOTE: `reporterEmail` is an OPTIONAL passthrough. This package cannot assume
 * the partner app uses `$secure()` / Alepha auth, so the proxy does not read
 * the session itself. Instead the browser dialog — which has the partner app's
 * user context — may include `reporterEmail` in the submitted form, and the
 * proxy forwards it as-is. It is a contact string shown escaped to the owner,
 * not an auth claim, so browser-supplied is acceptable.
 */
export class SigilProxyController {
  protected readonly forward = $inject(SigilForwardProvider);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * `POST /api/sigil/ingest`
   *
   * Stamps `country` + `visitor` server-side from edge headers, then
   * forwards the enriched envelope to Lore via {@link SigilForwardProvider}.
   * Returns `{ ok: false }` immediately if the forward provider is disabled
   * (i.e. `SIGIL_ID` is absent or the app is not in production).
   */
  ingest = $action({
    method: "POST",
    path: "/sigil/ingest",
    schema: {
      body: sigilIngestEnvelope,
      headers: t.object({
        "cf-ipcountry": t.optional(t.string()),
        "cf-connecting-ip": t.optional(t.string()),
        "x-forwarded-for": t.optional(t.string()),
        "user-agent": t.optional(t.string()),
      }),
      response: t.object({ ok: t.boolean() }),
    },
    handler: async (request) => {
      if (!this.forward.enabled()) {
        return { ok: false };
      }

      const country = request.headers["cf-ipcountry"] ?? undefined;

      /**
       * Derive the visitor hash without ever forwarding the raw IP.
       * Priority: cf-connecting-ip → x-forwarded-for → request.ip → "0.0.0.0".
       */
      const ip =
        request.headers["cf-connecting-ip"] ??
        request.headers["x-forwarded-for"] ??
        request.ip ??
        "0.0.0.0";

      const ua = request.headers["user-agent"] ?? "";
      const sigilId = this.forward.id() ?? "";
      const utcDate = new Date(this.dateTime.nowMillis())
        .toISOString()
        .slice(0, 10);
      const saltSecret = "lore-sigil";
      const dailySalt = this.crypto.hash(`${saltSecret}:${utcDate}`);
      const visitor = this.crypto.hash(`${sigilId}:${ip}:${ua}:${dailySalt}`);

      await this.forward.forwardIngest(request.body, { country, visitor });

      return { ok: true };
    },
  });

  /**
   * `POST /api/sigil/petition`
   *
   * Rebuilds a `FormData` from the parsed fields + screenshot file and
   * forwards it to Lore via {@link SigilForwardProvider.forwardPetition}.
   * Throws when the forward provider is disabled.
   */
  petition = $action({
    method: "POST",
    path: "/sigil/petition",
    schema: {
      body: t.object({
        ...sigilPetitionFields.properties,
        reporterEmail: t.optional(t.string({ maxLength: 320 })),
        screenshot: t.optional(t.file()),
      }),
      response: t.object({ ok: t.boolean() }),
    },
    handler: async (request) => {
      if (!this.forward.enabled()) {
        throw new AlephaError("Sigil not configured");
      }

      const {
        title,
        description,
        type,
        hostUrl,
        hostPath,
        reporterEmail,
        screenshot,
      } = request.body;

      const form = new FormData();
      form.set("title", title);
      form.set("description", description);
      form.set("type", type);
      form.set("hostUrl", hostUrl);
      form.set("hostPath", hostPath);
      if (reporterEmail) {
        form.set("reporterEmail", reporterEmail);
      }

      if (screenshot) {
        /**
         * `FileLike` is the framework's file interface; `FormData.set` needs a
         * `Blob`. Convert via `arrayBuffer()` to stay runtime-agnostic.
         */
        const buffer = await screenshot.arrayBuffer();
        const blob = new Blob([buffer], { type: screenshot.type });
        form.set("screenshot", blob, screenshot.name);
      }

      await this.forward.forwardPetition(form);

      return { ok: true };
    },
  });
}
