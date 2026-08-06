import { $env, $inject, z } from "alepha";
import { CryptoProvider, SecretProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $action } from "alepha/server";
import { sigilEnvelope } from "../shared/schemas/sigilEnvelope.ts";
import { sigilEnv } from "../sigilEnv.ts";
import { SigilSinkProvider } from "./SigilSinkProvider.ts";

/**
 * The one endpoint the browser talks to: its own origin.
 *
 * Two things happen here that can happen nowhere else. The app's server is the
 * only party that sees the visitor's IP, so it is the only one that can turn it
 * into a hash — and it does so before anything is forwarded, so the raw address
 * never leaves the machine. And because the browser posts same-origin, there is
 * no CORS to configure and no credential to ship to the client.
 *
 * `POST /api/sigil/ingest` — views, errors, vitals.
 *
 * The feedback redirect that used to live here is gone: the sink hands out a
 * URL in its config and the app renders it as a link. Resolving a project
 * server-side existed only to keep a secret id out of the browser, and there is
 * no such id any more.
 */
export class SigilProxyController {
  protected readonly sink = $inject(SigilSinkProvider);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly secrets = $inject(SecretProvider);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected env = $env(sigilEnv);

  ingest = $action({
    method: "POST",
    path: "/sigil/ingest",
    description: "Same-origin sigil intake for this app's own browser code",
    schema: {
      body: sigilEnvelope,
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
       * A daily-stable visitor hash that cannot be tested against a guess.
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
       * **And salted with a secret, which is what makes it one-way at all.**
       * The salt was once `hash("alepha-sigil:" + utcDate)` — derivable by
       * anyone who knows the date. Host and date are public, so a single
       * SHA-256 answered "did this IP with this user-agent visit today?"
       * against any stored value, and enumerating IPv4 × common user-agents was
       * tractable on one GPU. The rotation and the host scoping were real; the
       * one-wayness was not. Everything downstream that calls this data
       * "aggregated" — including the sink's own unique count — rests on this
       * line.
       *
       * `SIGIL_SALT` when set, else `APP_SECRET`. Alepha refuses to start in
       * production while `APP_SECRET` is still its built-in default, so the
       * fallback is guaranteed present, guaranteed strong, and guaranteed
       * identical across every replica — three properties this hash needs and
       * none of which a per-process value could give it. It also survives
       * rotating the sigil credential, which an earlier version of this
       * fallback did not.
       *
       * The derivation is labelled rather than hashing `APP_SECRET` directly.
       * `APP_SECRET` signs sessions; prefixing the purpose is the `info`
       * parameter idea from HKDF, and it is what keeps this salt provably
       * distinct from every other thing the same secret will be asked to derive
       * later. Retrofitting domain separation after hashes are stored is not
       * possible, so it goes in now.
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
      const secret = this.env.SIGIL_SALT || this.secrets.secretKey;
      const dailySalt = this.crypto.hash(
        `alepha-sigil-visitor:${secret}:${utcDate}`,
      );
      const visitor = this.crypto.hash(`${host}:${ip}:${ua}:${dailySalt}`);

      // The kill-switches are applied by the sink provider. Filtering here too
      // would be a second place to keep in sync with the fetched config.
      await this.sink.ingest(request.body, { country, visitor });

      return { ok: true };
    },
  });
}
