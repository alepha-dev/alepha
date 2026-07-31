import { $inject, z } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $action } from "alepha/server";
import { pulseEnvelope } from "../shared/schemas/pulseEnvelope.ts";
import { PulseSinkProvider } from "./PulseSinkProvider.ts";

/**
 * The one endpoint the browser talks to: its own origin.
 *
 * Two things happen here that can happen nowhere else. The app's server is the
 * only party that sees the visitor's IP, so it is the only one that can turn it
 * into a hash — and it does so before anything is forwarded, so the raw address
 * never leaves the machine. And because the browser posts same-origin, there is
 * no CORS to configure and no credential to ship to the client.
 *
 * `POST /api/pulse/ingest` — views, errors, vitals.
 *
 * The petition redirect that used to live here is gone: the sink hands out a
 * URL in its config and the app renders it as a link. Resolving a campaign
 * server-side existed only to keep a secret id out of the browser, and there is
 * no such id any more.
 */
export class PulseProxyController {
  protected readonly sink = $inject(PulseSinkProvider);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  ingest = $action({
    method: "POST",
    path: "/pulse/ingest",
    description: "Same-origin telemetry intake for this app's own browser code",
    schema: {
      body: pulseEnvelope,
      headers: z.object({
        "cf-ipcountry": z.string().optional(),
        "cf-connecting-ip": z.string().optional(),
        "x-forwarded-for": z.string().optional(),
        "user-agent": z.string().optional(),
        host: z.string().optional(),
      }),
      response: z.object({ ok: z.boolean() }),
    },
    handler: async (request) => {
      const country = request.headers["cf-ipcountry"] ?? undefined;

      /**
       * A daily-stable, non-reversible visitor hash.
       *
       * `cf-connecting-ip` → `x-forwarded-for` → `request.ip`, so it works
       * behind Cloudflare, behind Bay's proxy, and direct. The salt rotates
       * every UTC day, which is what makes the hash useless as a long-term
       * identifier while still counting a visitor once per day.
       *
       * Salted with this app's own host, so two apps behind one sink produce
       * different hashes for the same person — the sink counts each app's
       * visitors without ever being able to tell they are the same visitor.
       *
       * The host rather than the ingest key: rotating a key would otherwise
       * silently reset the day's unique count, and the host is what actually
       * identifies the site being visited.
       *
       * A cookie would be more accurate here, and per-origin by nature. It is
       * deliberately not used: an analytics cookie is not "strictly necessary"
       * under ePrivacy, so it would require consent — a banner in every app
       * that installs this package. A daily-rotating hash is the same trade
       * every cookieless analytics tool makes, and the rotation is what keeps
       * the identifier short-lived, which a cookie would not be.
       */
      const ip =
        request.headers["cf-connecting-ip"] ??
        request.headers["x-forwarded-for"] ??
        request.ip ??
        "0.0.0.0";
      const ua = request.headers["user-agent"] ?? "";
      const utcDate = new Date(this.dateTime.nowMillis())
        .toISOString()
        .slice(0, 10);
      const host = request.headers.host ?? "";
      const dailySalt = this.crypto.hash(`alepha-telemetry:${utcDate}`);
      const visitor = this.crypto.hash(`${host}:${ip}:${ua}:${dailySalt}`);

      // The kill-switches are applied by the sink provider. Filtering here too
      // would be a second place to keep in sync with the fetched config.
      await this.sink.ingest(request.body, { country, visitor });

      return { ok: true };
    },
  });
}
