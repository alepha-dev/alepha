import { $env, $inject, z } from "alepha";
import { CryptoProvider, SecretProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
// ⚠️ Type-only, and load-bearing. `alepha/security` declaration-merges `user`
// onto the request; without this the property does not exist in the program.
// Being type-only means no runtime dependency and no new module requirement:
// an app that does not register `alepha/security` simply sees `undefined`,
// and every visitor stays anonymous, which is the correct answer there.
import type {} from "alepha/security";
import { $action } from "alepha/server";

import { sigilEnvelope } from "../shared/schemas/sigilEnvelope.ts";
import { sigilBrowserName } from "../shared/sigilBrowserName.ts";
import { sigilClientAtom } from "../shared/sigilClientAtom.ts";
import { sigilDeviceClass } from "../shared/sigilDeviceClass.ts";
import { sigilHost } from "../shared/sigilHost.ts";
import { sigilNormalizeIp } from "../shared/sigilNormalizeIp.ts";
import { sigilOsName } from "../shared/sigilOsName.ts";
import { sigilTrafficKind } from "../shared/sigilTrafficKind.ts";
import { sigilVisitorPeriod } from "../shared/sigilVisitorPeriod.ts";
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
        "user-agent": z.string().optional(),
        host: z.string().optional(),
      }),
      response: z.object({
        ok: z.boolean(),
        config: sigilClientAtom.schema,
      }),
    },
    handler: async (request) => {
      const country = request.headers["cf-ipcountry"] ?? undefined;

      /**
       * A visitor hash, stable for one period, that cannot be tested against
       * a guess.
       *
       * **The address is `request.ip`, normalised.** The framework resolves
       * it the safe way (`ServerRequestParser.getRequestIp`): Cloudflare's
       * `cf-connecting-ip`, else the entry `TRUST_PROXY_HOPS` from the right
       * of `x-forwarded-for`. Reading `x-forwarded-for` here instead, as
       * this once did, hashed whatever the client typed in its leftmost hop,
       * so rotating one header minted a new visitor per request. IPv6 is cut
       * to its /64 (see `sigilNormalizeIp`).
       *
       * **The salt rotates per period**: a UTC calendar month by default,
       * an ISO week or a UTC day under `SIGIL_SALT_ROTATION`. The period is
       * what makes the hash useless as a long-term identifier while still
       * counting a visitor once per period, and it is stamped on the
       * envelope (`visitorPeriod`) so the sink knows which period a hash
       * belongs to.
       *
       * Salted with this app's own host, so two apps behind one sink produce
       * different hashes for the same person: the sink counts each app's
       * visitors without ever being able to tell they are the same visitor.
       *
       * **And salted with a secret, which is what makes it one-way at all.**
       * The salt was once `hash("alepha-sigil:" + utcDate)`, derivable by
       * anyone who knows the date. Host and date are public, so a single
       * SHA-256 answered "did this IP with this user-agent visit today?"
       * against any stored value, and enumerating IPv4 x common user-agents
       * was tractable on one GPU.
       *
       * `SIGIL_SALT` when set, else `APP_SECRET`. Alepha refuses to start in
       * production while `APP_SECRET` is still its built-in default, so the
       * fallback is guaranteed present, strong, and identical across every
       * replica. The derivation is labelled rather than hashing `APP_SECRET`
       * directly (the `info` idea from HKDF), which keeps this salt distinct
       * from every other thing the same secret derives.
       *
       * A cookie would be more accurate, and is deliberately not used: an
       * analytics cookie is not "strictly necessary" under ePrivacy, so it
       * would need consent, a banner in every app that installs this
       * package. A rotating hash is the trade every cookieless analytics tool
       * makes.
       */
      const ip = sigilNormalizeIp(request.ip ?? "0.0.0.0");
      const ua = request.headers["user-agent"] ?? "";
      const visitorPeriod = sigilVisitorPeriod(
        this.dateTime.nowMillis(),
        this.env.SIGIL_SALT_ROTATION,
      );
      const host = request.headers.host ?? "";
      const secret = this.env.SIGIL_SALT || this.secrets.secretKey;
      const periodSalt = await this.crypto.hash(
        `alepha-sigil-visitor:${secret}:${visitorPeriod}`,
      );
      // ⚠️ The SUBJECT of the hash, and the only thing this change swaps.
      //
      // The session is already on this request and costs nothing to read:
      // `alepha/server/auth` promotes the session cookie into an
      // `Authorization` header on `server:request:before`, and
      // `ServerSecurityProvider` runs at `priority: "last"` and resolves
      // `request.user` for EVERY route, secured or not. This endpoint is not
      // secured and gets the user anyway.
      //
      // Everything around it is untouched, which is the point. Still salted
      // with the app's own host, so two apps behind one sink cannot be
      // correlated. Still rotating per period, so it is useless as a long-term
      // identifier. Still one-way: the user id never leaves the app, only its
      // hash does, and the sink can no more reverse `u:<uuid>` than it could
      // reverse an IP.
      //
      // What it fixes, neither of which is fixable from an IP:
      //  - an office or a NAT where twenty people share one address and one
      //    Chrome build currently count as ONE visitor;
      //  - a phone that changes address mid-day, which currently counts as
      //    TWO;
      //  - one person on a laptop and a phone, both signed in, which becomes
      //    one visitor, and that is the correct answer.
      //
      // ⚠️ **Cookie sessions only.** The browser reaches this endpoint with a
      // plain same-origin `fetch`, which carries cookies and does not carry an
      // `Authorization` header. An app holding its token in memory therefore
      // reports every visit as anonymous, silently and correctly - there is no
      // session on the request to read. Read a flat 0% signed in as that
      // before reading it as a bug.
      //
      // ⚠️ Somebody who browses signed out and then signs in within one
      // period counts as two identities in it: the anonymous half is already
      // written, and nothing can merge it retroactively. Bounded at one extra
      // per person per period, and only in a period they arrive signed out.
      const subject = request.user?.id
        ? `u:${request.user.id}`
        : `ip:${ip}:${ua}`;
      const visitor = await this.crypto.hash(
        `${host}:${subject}:${periodSalt}`,
      );

      // Classified here rather than in the browser for the same reason
      // `country` is: the header is already in hand server-side, so spending
      // envelope bytes on something the app can read for free would be waste.
      const device = sigilDeviceClass(ua);

      // Same header, second question, and the same argument for asking it here:
      // the app's server already holds the user-agent. Only a client that runs
      // JavaScript ever reaches this endpoint, so what this separates is the
      // crawler that renders from the reader - not the crawler that merely
      // fetches, which never arrives.
      const traffic = sigilTrafficKind(ua);

      // Third and fourth questions of the same header, in the same place, at
      // the same cost. This seam has taken four fields now, which is what it
      // is for: things only the app's own server knows.
      const browser = sigilBrowserName(ua);
      const os = sigilOsName(ua);

      // Fifth field of the same seam, and the first that reads something other
      // than the user-agent. Derived from the session the hash above already
      // closes over - and stamped anyway rather than left to be inferred from
      // it, because a hash is opaque by construction and `SigilSinkProvider`'s
      // own doctrine is that redundancy must not be made load-bearing.
      const auth = request.user?.id ? "user" : "anon";

      // The kill-switches are applied by the sink provider. Filtering here too
      // would be a second place to keep in sync with the fetched config.
      //
      // `host` is the same header the salt above is built from, kept this time
      // rather than hashed away. It is the app naming its own address, which
      // is the one thing a sink cannot work out for itself: it only ever sees
      // the app's outbound request. Normalized here so the wire carries an
      // authority or nothing - and normalized AGAIN by the sink, which cannot
      // trust a sender holding a token any further than it can trust a browser.
      // Every error arriving here came from a browser: the app's own server
      // reports through the sink provider directly, never through this
      // unauthenticated endpoint. The origin is the envelope's to claim, so
      // it is overwritten rather than trusted; left alone, anyone could post
      // errors that read as server failures.
      const body = request.body.errors
        ? {
            ...request.body,
            errors: request.body.errors.map((error) => ({
              ...error,
              origin: "client" as const,
            })),
          }
        : request.body;

      await this.sink.ingest(body, {
        country,
        visitor,
        visitorPeriod,
        device,
        traffic,
        browser,
        os,
        auth,
        host: sigilHost(host),
      });

      // The config rides back on the call the browser was making anyway. A page
      // served from a file or a cache carries one older than the visit, and
      // this is how it catches up — without a second endpoint, and without a
      // request whose only purpose is to ask.
      return { ok: true, config: this.sink.clientConfig() };
    },
  });
}
