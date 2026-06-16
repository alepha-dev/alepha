import { $inject, t } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $action, $route } from "alepha/server";
import { sigilIngestEnvelope } from "../shared/schemas/sigilIngestEnvelope.ts";
import {
  SIGIL_PETITION_CONTEXT_MAX_LEN,
  SIGIL_PETITION_CONTEXT_PARAMS,
} from "../shared/sigilPetitionContext.ts";
import { SigilForwardProvider } from "./SigilForwardProvider.ts";

/**
 * Same-origin proxy controller that the browser calls.
 *
 * Stamps server-derived fields (`country`, `visitor`) onto ingest envelopes
 * before forwarding to Lore, and resolves the petition launcher redirect.
 * Two endpoints:
 *
 * - `POST /api/sigil/ingest` — telemetry envelope (views, errors, vitals).
 * - `GET  /sigil/request` — 302-redirects to the first-party Lore
 *   petition page (`{loreOrigin}/c/:campaignId/request`).
 *
 * The `visitor` hash is a daily-stable, non-reversible fingerprint:
 * `sha256(sigilId + ":" + ip + ":" + userAgent + ":" + dailySalt)` where
 * `dailySalt = sha256((SIGIL_IP_SALT ?? "lore-sigil") + ":" + utcDate)`.
 * The raw IP is never forwarded or stored.
 *
 * The sigil id is a server-only secret that powers telemetry; the
 * `GET /sigil/request` proxy resolves it to a campaign id server-side
 * and redirects, so the id never reaches the browser.
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

      // Server-side defense-in-depth: drop any bucket whose feature is off,
      // even though the client already filters before sending. Bucket→feature:
      // views→beacon, errors→blights, vitals→vitals.
      const features = this.forward.features();
      const filtered: typeof request.body = {
        ...(features.includes("beacon") ? { views: request.body.views } : {}),
        ...(features.includes("blights")
          ? { errors: request.body.errors }
          : {}),
        ...(features.includes("vitals") ? { vitals: request.body.vitals } : {}),
      };

      if (!filtered.views && !filtered.errors && !filtered.vitals) {
        return { ok: true };
      }

      await this.forward.forwardIngest(filtered, { country, visitor });

      return { ok: true };
    },
  });

  /**
   * `GET /sigil/request`
   *
   * The feedback button does a synchronous same-origin
   * `window.open("/sigil/request")`. This proxy resolves the configured
   * sigil → campaign id server-side and 302-redirects to the first-party
   * Lore petition page, so the sigil id never reaches the browser.
   *
   * `$route` (not `$action`) so the endpoint lives at the ROOT path and the
   * handler can drive `request.reply` directly to set the redirect status +
   * `location` header. `$route` does NOT prefix with `/api` — that namespace
   * is reserved for the `$action` dispatcher, which would shadow this route
   * (a `/api/sigil/request` `$route` 404s); it must live at the root.
   *
   * Replies `404` when the provider is disabled or the campaign id cannot
   * be resolved; otherwise `302` to `{loreOrigin}/c/:campaignId/request`.
   */
  request = $route({
    method: "GET",
    path: "/sigil/request",
    handler: async (request) => {
      const { reply } = request;

      if (!this.forward.enabled()) {
        reply.setStatus(404);
        return;
      }

      const campaignId = await this.forward.campaignId();
      if (campaignId == null) {
        reply.setStatus(404);
        return;
      }

      // Forward ONLY the whitelisted page-context params onto the redirect,
      // re-encoded and length-capped. A strict allow-list keeps the embedding
      // page from smuggling arbitrary query params into the Lore URL.
      const forwarded = new URLSearchParams();
      for (const key of SIGIL_PETITION_CONTEXT_PARAMS) {
        const value = request.url?.searchParams.get(key);
        if (value) {
          forwarded.set(key, value.slice(0, SIGIL_PETITION_CONTEXT_MAX_LEN));
        }
      }
      const query = forwarded.toString();
      const base = `${this.forward.loreOrigin()}/c/${campaignId}/request`;

      reply.redirect(query ? `${base}?${query}` : base, 302);
    },
  });
}
