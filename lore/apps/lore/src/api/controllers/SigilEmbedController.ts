import { $inject, t } from "alepha";
import { $logger } from "alepha/logger";
import { $route, HttpError, type ServerRequest } from "alepha/server";
import type { Sigil } from "../entities/sigils.ts";
import { BeaconIngestService } from "../services/BeaconIngestService.ts";
import { BlightIngestService } from "../services/BlightIngestService.ts";
import { isBotUserAgent } from "../services/bot-ua-patterns.ts";
import { renderSigilBundle } from "../services/SigilEmbedBundle.ts";
import { SigilIngestSupport } from "../services/SigilIngestSupport.ts";
import { SigilService } from "../services/SigilService.ts";

/**
 * Blights ingestion request body. The embed bundle batches crash events
 * ("every 5s or 10 events") into one POST. `ingestKey` may also be passed
 * via the `X-Sigil-Key` header — the body field is the fallback for
 * clients that cannot set custom headers.
 */
const blightIngestBodySchema = t.object({
  ingestKey: t.optional(t.string({ maxLength: 128 })),
  events: t.array(
    t.object({
      name: t.optional(t.string({ maxLength: 500 })),
      message: t.optional(t.string({ maxLength: 5_000 })),
      stack: t.optional(t.string({ maxLength: 20_000 })),
      sourceUrl: t.optional(t.string({ maxLength: 5_000 })),
    }),
    { minItems: 1, maxItems: 20 },
  ),
});

/**
 * Beacons ingestion request body. The embed bundle sends one ping per page
 * load (and per `trackRoute()` SPA navigation). `ingestKey` may also be
 * passed via the `X-Sigil-Key` header — the body field is the fallback for
 * clients that cannot set custom headers.
 */
const beaconIngestBodySchema = t.object({
  ingestKey: t.optional(t.string({ maxLength: 128 })),
  path: t.optional(t.string({ maxLength: 5_000 })),
});

/** The reply object a `$route` handler receives on `request.reply`. */
type ServerReply = ServerRequest["reply"];

/**
 * The slice of a `$route` request the shared `/sigils/*` helpers
 * ({@link SigilEmbedController.handlePreflight},
 * {@link SigilEmbedController.runIngestGates}) actually read. Declared
 * structurally rather than as a `ServerRequest<…>` generic because the
 * generic's config slots expect `TypeBox` schemas, not plain TS shapes —
 * a structural subset keeps both POST handlers (whose own route schemas
 * carry extra headers like `cf-ipcountry`) assignable to it.
 */
type SigilIngestRequest = {
  params: { id: string };
  headers: {
    origin?: string;
    "x-sigil-key"?: string;
    "user-agent"?: string;
  };
  reply: ServerReply;
};

/**
 * Shared TTL (seconds) for the embed script — used both as the
 * `Cache-Control: max-age` of the served `.js` and as the
 * `Access-Control-Max-Age` of the CORS preflight.
 */
const EMBED_CACHE_SECONDS = 300;

/**
 * Route-level CORS for the `/sigils/*` embed surface. `origin: ""` is never
 * `isOriginAllowed`, so `AlephaServerCors`'s global hook never emits an
 * `Access-Control-Allow-Origin` here — leaving {@link
 * SigilEmbedController.applySigilCors} the sole authority over that header.
 * `methods`/`headers` are required by `CorsOptions`; their values are inert
 * (the global hook still sets them generically, but a response with no
 * `Access-Control-Allow-Origin` is unreadable cross-origin regardless).
 */
const SIGIL_ROUTE_CORS = {
  origin: "",
  methods: ["GET", "POST", "OPTIONS"],
  headers: ["Content-Type", "X-Sigil-Key"],
};

/**
 * The public face of the Sigils feature: serves the embed script a partner
 * site loads with one `<script src=".../sigils/<id>/embed.js">` line.
 *
 * `$route` (not `$action`) — like `VersionController` — so the endpoint
 * lives at the ROOT path, not under the `/api` prefix, and carries no auth.
 * It is public on purpose: the served body is partner-facing by design.
 *
 * **Path shape — `/sigils/:id/embed.js`, NOT `/sigils/:id.js`.** Alepha's
 * router is a trie that splits the path on `/` and treats a segment that
 * starts with `:` as a *whole-segment* param. `:id.js` is therefore parsed
 * as a single param literally named `id.js` that captures `<uuid>.js` — the
 * `.js` is never a literal suffix and `id` never exists. Putting `.js` in
 * its own segment (`:id/embed.js`) is the only shape that captures a clean
 * `id`. The partner `<script src>` ends in `/embed.js`, still cache-friendly.
 *
 * **CORS.** The capability ingestion endpoints (`/sigils/:id/blights`,
 * `/sigils/:id/beacon`) land in later quests and are `fetch()`ed
 * cross-origin. They — and this route — need `Access-Control-Allow-Origin`
 * reflecting the *sigil's own* `allowedOrigins`, never `*`. Because the
 * allow-list is per-sigil (resolved only after the DB lookup), the static
 * `$cors({ origin })` middleware cannot express it; CORS is therefore
 * applied per request via {@link applySigilCors}.
 *
 * To keep `applySigilCors` the *sole* authority over
 * `Access-Control-Allow-Origin` on this surface, both routes carry a
 * route-level `cors: { origin: "" }`. `AlephaServerCors`'s global
 * `onRequest` hook honours `route.cors` over its permissive `origin: "*"`
 * default, and an empty `origin` is never `isOriginAllowed`, so the global
 * hook never emits an `Access-Control-Allow-Origin` for `/sigils/*`. That
 * means `applySigilCors` only ever *sets* the header — it never has to undo
 * one the framework set. `AlephaServerCors` stays registered (see `LoreApi`)
 * so the framework still auto-generates the `OPTIONS` preflight routes the
 * future POST endpoints rely on.
 */
export class SigilEmbedController {
  protected log = $logger();
  protected sigils = $inject(SigilService);
  protected blights = $inject(BlightIngestService);
  protected beacons = $inject(BeaconIngestService);
  protected ingestSupport = $inject(SigilIngestSupport);

  /**
   * The `features.sigils` master gate, shared by every public `/sigils/*`
   * capability surface — `getEmbedScript`, `getRequestPage`, and the
   * blights/beacon ingestion via {@link runIngestGates}.
   *
   * When the campaign owner toggles "Sigils" OFF the whole embed surface
   * for that campaign is disabled (folio #10: "When Sigils is OFF: no
   * embed script at all") — even for already-issued sigils. This is the
   * one place the `campaign.features.sigils` lookup lives, so the four
   * call sites do not each re-implement it.
   *
   * @returns `true` when the master toggle is ON; `false` when OFF.
   */
  protected async isSigilsFeatureOn(campaignId: number): Promise<boolean> {
    return this.ingestSupport.isFeatureOn(campaignId, "sigils");
  }

  /**
   * `GET /sigils/:id/embed.js` — the embed script.
   *
   * - missing sigil → **404**
   * - live sigil → **200**, `Content-Type: text/javascript`,
   *   `Cache-Control: public, max-age=300`, body = the per-request bundle.
   *
   * No `schema.response` is declared on purpose: that keeps the framework
   * from JSON-encoding the body, so the raw JS string is served verbatim.
   */
  getEmbedScript = $route({
    method: "GET",
    path: "/sigils/:id/embed.js",
    // See the class doc — keeps `applySigilCors` the sole authority over
    // `Access-Control-Allow-Origin` for this route.
    cors: SIGIL_ROUTE_CORS,
    schema: {
      params: t.object({ id: t.string() }),
    },
    handler: async (request) => {
      const { params, reply } = request;
      const origin = request.headers.origin;

      const sigil = await this.sigils.findForEmbed(params.id);

      // Resolve before doing anything else — CORS still applies on the
      // error responses so a cross-origin `fetch()` can read the status.
      // A deleted sigil is hard-deleted, so a missing row is just a 404.
      if (!sigil) {
        // No sigil to scope CORS against → no `Access-Control-Allow-Origin`
        // at all (the global hook never set one — see class doc).
        throw new HttpError({ status: 404, message: "Sigil not found" });
      }

      // Master gate — `features.sigils` OFF disables the whole embed
      // surface for the campaign, even for already-issued sigils.
      if (!(await this.isSigilsFeatureOn(sigil.campaignId))) {
        this.applySigilCors(reply, origin, sigil);
        throw new HttpError({
          status: 403,
          message: "Sigils are disabled for this campaign",
        });
      }

      this.applySigilCors(reply, origin, sigil);
      reply.setHeader("content-type", "text/javascript; charset=UTF-8");
      reply.setHeader(
        "cache-control",
        `public, max-age=${EMBED_CACHE_SECONDS}`,
      );

      return renderSigilBundle({
        id: sigil.id,
        kinds: sigil.kinds ?? [],
        ingestKey: sigil.ingestKey,
        allowedOrigins: sigil.allowedOrigins ?? [],
        excludedPaths: sigil.excludedPaths ?? [],
        // The partner-facing origin to point the popup launcher at —
        // derived from the request URL so dev/prod-like/deploy all work.
        loreOrigin: request.url.origin,
      });
    },
  });

  /**
   * `GET /sigils/:id/request` — the petition popup landing route.
   *
   * The sigil floating button opens a popup at this path (carrying
   * `?path`/`?url`/`?type` from the embedding page). This route resolves the
   * sigil → campaign, validates it, then **302-redirects** to the existing
   * first-party request SPA route `/c/:campaignId/request`, forwarding the
   * launcher's query params and adding `?sigil=<id>` so the SPA can populate
   * the petition's `source.sigilId`.
   *
   * Redirect (rather than rendering the SPA here) keeps the surface minimal:
   * no new SPA route, no new server-side HTML rendering — the SPA route
   * `campaignPetitionRequest` already handles login round-trips and draft
   * persistence; it just learns a "sigil mode" from the `?sigil` param.
   *
   * - missing sigil → **404**
   * - sigil without `"petition"` in `kinds` → **403** (the form is not usable)
   *
   * No CORS headers: this is a top-level browser navigation (the popup's
   * `window.open`), not a cross-origin `fetch()`, so the SOP read-block that
   * CORS works around does not apply.
   */
  getRequestPage = $route({
    method: "GET",
    path: "/sigils/:id/request",
    cors: SIGIL_ROUTE_CORS,
    schema: {
      params: t.object({ id: t.string() }),
      query: t.object({
        path: t.optional(t.string()),
        url: t.optional(t.string()),
        type: t.optional(t.string()),
      }),
    },
    handler: async (request) => {
      const { params, query, reply } = request;

      const sigil = await this.sigils.findForEmbed(params.id);
      if (!sigil) {
        throw new HttpError({ status: 404, message: "Sigil not found" });
      }
      // Master gate — `features.sigils` OFF disables the whole embed
      // surface, mirroring the blights/beacon ingestion gates.
      if (!(await this.isSigilsFeatureOn(sigil.campaignId))) {
        throw new HttpError({
          status: 403,
          message: "Sigils are disabled for this campaign",
        });
      }
      // Per-capability gate — `features.embeddedPetitions` is the owner's
      // opt-in lever for the petition capability, same role `blights` /
      // `beacon` play for their ingestion endpoints.
      if (
        !(await this.ingestSupport.isFeatureOn(
          sigil.campaignId,
          "embeddedPetitions",
        ))
      ) {
        throw new HttpError({
          status: 403,
          message: "Embedded petitions are disabled for this campaign",
        });
      }
      if (!(sigil.kinds ?? []).includes("petition")) {
        throw new HttpError({
          status: 403,
          message: "Sigil does not grant the petition capability",
        });
      }

      // Forward the launcher's params and tag the sigil id on so the SPA
      // request form runs in "sigil popup mode" and stamps `source.sigilId`.
      const target = new URLSearchParams();
      target.set("sigil", sigil.id);
      if (query.path) target.set("path", query.path);
      if (query.url) target.set("url", query.url);
      if (query.type) target.set("type", query.type);

      reply.redirect(
        `/c/${sigil.campaignId}/request?${target.toString()}`,
        302,
      );
    },
  });

  /**
   * `OPTIONS /sigils/:id/embed.js` — CORS preflight.
   *
   * `AlephaServerCors` only auto-generates `OPTIONS` routes for non-GET
   * routes, so the GET embed route needs its preflight declared explicitly.
   * Establishing it here (rather than only for the future POST ingestion
   * endpoints) keeps the whole `/sigils/*` surface preflight-answerable and
   * gives later quests a working pattern to copy. Delegates to the shared
   * {@link handlePreflight} — every `/sigils/*` preflight is byte-identical
   * bar its path.
   */
  preflightEmbedScript = $route({
    method: "OPTIONS",
    path: "/sigils/:id/embed.js",
    // See the class doc — keeps `applySigilCors` the sole authority over
    // `Access-Control-Allow-Origin` for this route.
    cors: SIGIL_ROUTE_CORS,
    schema: {
      params: t.object({ id: t.string() }),
    },
    handler: (request) => this.handlePreflight(request),
  });

  /**
   * `POST /sigils/:id/blights` — public crash-capture ingestion.
   *
   * `$route`, no auth: the embed bundle on a partner page `fetch()`es it
   * cross-origin. Defence is layered as six gates, ALL required before any
   * write happens — a failed gate stores nothing:
   *
   * 1. sigil resolves           — 404 missing
   * 2. campaign `blights` on    — 403 (owner opt-in lever)
   * 3. sigil grants `"blights"` — 403
   * 4. `ingestKey` matches      — 403 (body field OR `X-Sigil-Key` header)
   * 5. `Origin` allow-listed    — 403
   * 6. UA not a known bot       — 204, silently dropped (noise filter)
   *
   * On success: each event is sanitized, fingerprinted and upserted; the
   * per-IP novelty cap may silently drop individual NEW fingerprints. The
   * response is a `204` regardless of per-event outcome — the client is
   * fire-and-forget and must not learn the inbox state.
   *
   * NB: the per-IP novelty cap protects inbox integrity, NOT request
   * volume — every call still costs a Worker invocation + DB reads. The
   * Cloudflare WAF per-IP rate-limit rule on `/sigils/*` is what bounds
   * cost; see CLAUDE.md "Sigils ingestion — Cloudflare WAF".
   */
  ingestBlights = $route({
    method: "POST",
    path: "/sigils/:id/blights",
    cors: SIGIL_ROUTE_CORS,
    schema: {
      params: t.object({ id: t.string() }),
      body: blightIngestBodySchema,
      headers: t.object({
        "x-sigil-key": t.optional(t.string()),
        "user-agent": t.optional(t.string()),
        origin: t.optional(t.string()),
      }),
    },
    handler: async (request) => {
      const { body, reply } = request;

      // Gates 1-6. A `null` return is the bot-drop case — 204, no write.
      const sigil = await this.runIngestGates(request, {
        feature: "blights",
        capability: "blights",
        ingestKey: body.ingestKey,
        disabledMessage: "Blights capture is disabled for this campaign",
        featureOn: (campaignId) => this.blights.isBlightsFeatureOn(campaignId),
      });
      if (!sigil) {
        reply.setStatus(204);
        return;
      }

      // The client IP. `request.ip` is undefined off-proxy in dev/tests —
      // fall back so the per-IP cap and hashing still have a stable value.
      const ip = request.ip ?? "0.0.0.0";

      for (const event of body.events) {
        try {
          await this.blights.ingestEvent(sigil.id, event, ip);
        } catch (err) {
          // One bad event must not sink the batch.
          this.log.warn("Blight ingest failed for an event", err);
        }
      }

      reply.setStatus(204);
    },
  });

  /**
   * `OPTIONS /sigils/:id/blights` — CORS preflight for the ingestion POST.
   *
   * A cross-origin `fetch()` with a JSON body + `X-Sigil-Key` header is not
   * "simple", so the browser preflights. `AlephaServerCors` auto-generates
   * an `OPTIONS` route for non-GET routes, but with the route-level
   * `cors: { origin: "" }` it would never emit `Access-Control-Allow-Origin`
   * — so the shared {@link handlePreflight} resolves the sigil and applies
   * the scoped CORS headers, same as the embed-script preflight.
   */
  preflightIngestBlights = $route({
    method: "OPTIONS",
    path: "/sigils/:id/blights",
    cors: SIGIL_ROUTE_CORS,
    schema: {
      params: t.object({ id: t.string() }),
    },
    handler: (request) => this.handlePreflight(request),
  });

  /**
   * `POST /sigils/:id/beacon` — public, cookieless pageview ingestion.
   *
   * `$route`, no auth: the embed bundle on a partner page `fetch()`es it
   * cross-origin, one fire-and-forget ping per page load (and per SPA route
   * change via `window.LoreSigil.trackRoute()`). Defence mirrors the
   * `/blights` endpoint — six gates, ALL required before any write:
   *
   * 1. sigil resolves          — 404 missing
   * 2. campaign `beacon` on    — 403 (owner opt-in lever)
   * 3. sigil grants `"beacon"` — 403
   * 4. `ingestKey` matches     — 403 (body field OR `X-Sigil-Key` header)
   * 5. `Origin` allow-listed   — 403
   * 6. UA not a known bot      — 204, silently dropped (noise filter)
   *
   * On success: the visitor's day-scoped `sessionHash` is derived
   * server-side and `INSERT OR IGNORE`d; the pageview is aggregated with a
   * per-sigil/day distinct-path cap. The response is `204` regardless of
   * outcome — the client is fire-and-forget.
   *
   * NB: there is intentionally NO per-IP throughput cap here. The raw view
   * `count` is best-effort/inflatable by design (folio #12) — the
   * trustworthy metric is unique-visitors; volume abuse is bounded by the
   * Cloudflare WAF per-IP rule (see CLAUDE.md "Sigils ingestion — WAF").
   */
  ingestBeacon = $route({
    method: "POST",
    path: "/sigils/:id/beacon",
    cors: SIGIL_ROUTE_CORS,
    schema: {
      params: t.object({ id: t.string() }),
      body: beaconIngestBodySchema,
      headers: t.object({
        "x-sigil-key": t.optional(t.string()),
        "user-agent": t.optional(t.string()),
        "cf-ipcountry": t.optional(t.string()),
        origin: t.optional(t.string()),
      }),
    },
    handler: async (request) => {
      const { body, reply } = request;

      // Gates 1-6. A `null` return is the bot-drop case — 204, no write.
      const sigil = await this.runIngestGates(request, {
        feature: "beacon",
        capability: "beacon",
        ingestKey: body.ingestKey,
        disabledMessage: "Beacons is disabled for this campaign",
        featureOn: (campaignId) => this.beacons.isBeaconFeatureOn(campaignId),
      });
      if (!sigil) {
        reply.setStatus(204);
        return;
      }
      const ua = request.headers["user-agent"];

      // The client IP — used ONLY to derive the day-scoped sessionHash,
      // never stored. `request.ip` is undefined off-proxy in dev/tests, so
      // fall back to a stable value.
      const ip = request.ip ?? "0.0.0.0";
      // Coarse country resolved free at the Cloudflare edge. Never the raw
      // IP. Absent off-Cloudflare (dev/tests) → `ZZ` fallback.
      const country = request.headers["cf-ipcountry"] ?? "ZZ";

      try {
        await this.beacons.ingestPing(
          sigil.id,
          { path: body.path },
          ip,
          ua ?? "",
          country,
        );
      } catch (err) {
        // Fire-and-forget — a failed ping must not surface to the client,
        // but it MUST be loud in the logs: a swallowed `warn` here is what
        // hid a total beacon-ingestion outage on D1. Log at `error`.
        this.log.error("Beacon ingest failed", err);
      }

      reply.setStatus(204);
    },
  });

  /**
   * `OPTIONS /sigils/:id/beacon` — CORS preflight for the ingestion POST.
   *
   * Mirrors {@link preflightIngestBlights}: a cross-origin `fetch()` with a
   * JSON body + `X-Sigil-Key` header is preflighted, and the route-level
   * `cors: { origin: "" }` means this explicit handler is what applies the
   * per-sigil `Access-Control-Allow-Origin`.
   */
  preflightIngestBeacon = $route({
    method: "OPTIONS",
    path: "/sigils/:id/beacon",
    cors: SIGIL_ROUTE_CORS,
    schema: {
      params: t.object({ id: t.string() }),
    },
    handler: (request) => this.handlePreflight(request),
  });

  /**
   * Shared CORS-preflight handler for the `/sigils/*` surface.
   *
   * Every `/sigils/:id/*` `OPTIONS` route is byte-identical bar its path:
   * resolve the sigil, apply the per-sigil scoped CORS headers if it
   * exists, short-circuit `204`. `AlephaServerCors` only auto-generates
   * `OPTIONS` for non-GET routes and the route-level `cors: { origin: "" }`
   * means it never emits `Access-Control-Allow-Origin` — so this is the
   * sole authority on the preflight response, same as {@link
   * applySigilCors} is for the real handlers.
   */
  protected async handlePreflight(request: SigilIngestRequest): Promise<void> {
    const { params, reply } = request;
    const origin = request.headers.origin;
    const sigil = await this.sigils.findForEmbed(params.id);
    if (sigil) {
      this.applySigilCors(reply, origin, sigil);
    }
    reply.setStatus(204);
  }

  /**
   * Run the ingestion gates shared by `POST /sigils/:id/blights` and
   * `POST /sigils/:id/beacon`. ALL gates must pass before any write:
   *
   * 1. sigil resolves            — 404 missing
   * 1b. campaign `sigils` on     — 403 (master toggle)
   * 2. campaign feature on       — 403 (owner opt-in lever)
   * 3. sigil grants capability   — 403
   * 4. `ingestKey` matches       — 403 (body field OR `X-Sigil-Key` header)
   * 5. `Origin` allow-listed     — 403
   * 6. UA not a known bot        — caller 204s, silently dropped
   *
   * @returns the resolved sigil when gates 1-6 all pass; `null` for the
   *   bot-drop case (gate 6) so the caller just returns `204`. A failed
   *   gate 1-5 throws the appropriate `HttpError`.
   */
  protected async runIngestGates(
    request: SigilIngestRequest,
    opts: {
      /** `campaign.features` key checked by gate 2. */
      feature: "blights" | "beacon";
      /** Capability the sigil's `kinds` must include (gate 3). */
      capability: string;
      /** `ingestKey` from the request body (gate 4 fallback). */
      ingestKey: string | undefined;
      /** 403 message when gate 2 fails. */
      disabledMessage: string;
      /** Resolves whether the campaign opted into the feature (gate 2). */
      featureOn: (campaignId: number) => Promise<boolean>;
    },
  ): Promise<Sigil | null> {
    const { params, reply } = request;
    const origin = request.headers.origin;

    // Gate 1 — sigil resolves. Sigils are hard-deleted, so a missing row
    // is just a 404 (no soft-deleted/revoked state to distinguish).
    const sigil = await this.sigils.findForEmbed(params.id);
    if (!sigil) {
      throw new HttpError({ status: 404, message: "Sigil not found" });
    }

    // CORS scoped to this sigil — applied now so error replies below are
    // readable by the cross-origin caller.
    this.applySigilCors(reply, origin, sigil);

    // Master gate — `features.sigils` OFF disables the whole embed surface
    // for the campaign, regardless of the per-capability toggle below.
    if (!(await this.isSigilsFeatureOn(sigil.campaignId))) {
      throw new HttpError({
        status: 403,
        message: "Sigils are disabled for this campaign",
      });
    }

    // Gate 2 — campaign opted into the feature.
    if (!(await opts.featureOn(sigil.campaignId))) {
      throw new HttpError({ status: 403, message: opts.disabledMessage });
    }

    // Gate 3 — sigil grants the capability.
    if (!(sigil.kinds ?? []).includes(opts.capability)) {
      throw new HttpError({
        status: 403,
        message: `Sigil does not grant the ${opts.capability} capability`,
      });
    }

    // Gate 4 — ingestKey matches (header takes precedence over body).
    const presentedKey = request.headers["x-sigil-key"] ?? opts.ingestKey;
    if (!presentedKey || presentedKey !== sigil.ingestKey) {
      throw new HttpError({ status: 403, message: "Invalid ingest key" });
    }

    // Gate 5 — Origin must be on the sigil's allow-list.
    const allowed = sigil.allowedOrigins ?? [];
    if (!origin || !allowed.includes(origin)) {
      throw new HttpError({ status: 403, message: "Origin not allowed" });
    }

    // Gate 6 — bot UA filter (noise filter, not a boundary — UA is
    // spoofable). A match makes the caller drop the payload and 204. The
    // `DISABLE_BOT_CHECK` env escape hatch skips this gate entirely.
    const ua = request.headers["user-agent"];
    if (!this.blights.isBotCheckDisabled() && isBotUserAgent(ua)) {
      return null;
    }

    return sigil;
  }

  /**
   * Reflect the requesting `Origin` in the CORS headers — but only if it is
   * on the sigil's own `allowedOrigins` allow-list. Never emits `*`: a sigil
   * with an empty allow-list (or a request from an un-listed origin) gets no
   * `Access-Control-Allow-Origin` at all, so the browser blocks the read.
   *
   * This method only ever *sets* headers. It relies on the route-level
   * `cors: { origin: "" }` (see class doc) ensuring `AlephaServerCors`'s
   * global hook never set an `Access-Control-Allow-Origin` for `/sigils/*`
   * — so an un-listed origin simply ends up with no such header.
   *
   * Exposed for the future ingestion-endpoint quests to reuse so their CORS
   * is consistent with the embed route's.
   */
  protected applySigilCors(
    reply: ServerReply,
    origin: string | undefined,
    sigil: Sigil,
  ): void {
    const allowed = sigil.allowedOrigins ?? [];
    if (origin && allowed.includes(origin)) {
      reply.setHeader("access-control-allow-origin", origin);
      reply.setHeader("vary", "Origin");
      reply.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
      reply.setHeader(
        "access-control-allow-headers",
        "Content-Type, X-Sigil-Key",
      );
      reply.setHeader("access-control-max-age", String(EMBED_CACHE_SECONDS));
    }
  }
}
