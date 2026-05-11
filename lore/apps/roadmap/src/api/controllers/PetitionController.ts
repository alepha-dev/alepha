import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { $inject, t } from "alepha";
import { FileService, files } from "alepha/api/files";
import { $bucket } from "alepha/bucket";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { $secure } from "alepha/security";
import {
  $action,
  BadRequestError,
  ForbiddenError,
  HttpError,
  NotFoundError,
  okSchema,
  UnauthorizedError,
} from "alepha/server";
import { FileSystemProvider } from "alepha/system";
import { type Beacon, beacons } from "../entities/beacons.ts";
import { type Campaign, campaigns } from "../entities/campaigns.ts";
import { quests } from "../entities/quests.ts";
import { AppSecurityProvider } from "../providers/AppSecurityProvider.ts";
import {
  type BeaconResource,
  beaconResourceSchema,
} from "../schemas/beaconResourceSchema.ts";
import { BeaconRateLimiter } from "../services/BeaconRateLimiter.ts";

const DEFAULT_RATE_LIMIT = 10;

const beaconBodySchema = t.object({
  title: t.string({ minLength: 1, maxLength: 200 }),
  description: t.string({ minLength: 1, maxLength: 10_000 }),
  reportType: t.enum(["bug", "feature"], { mode: "text" }),
  reporterEmail: t.optional(t.string({ format: "email" })),
  context: t.object({
    url: t.string({ maxLength: 2000 }),
    path: t.string({ maxLength: 2000 }),
    userAgent: t.string({ maxLength: 1000 }),
    viewport: t.object({ width: t.integer(), height: t.integer() }),
    locale: t.optional(t.string({ maxLength: 32 })),
    referrer: t.optional(t.string({ maxLength: 2000 })),
  }),
  screenshotFileId: t.optional(t.uuid()),
});

/**
 * Public ingest endpoint for the Beacons widget.
 *
 * Auth/security:
 * - Token in `?t=` (constant-time compared to campaign.beacons.publicToken)
 * - Origin in `Origin` header (allow-list with `*.domain` wildcard support)
 * - Sliding 60s rate-limit per (campaign, ipHash)
 * - 24h daily cap per campaign
 * - Client IP is hashed (sha256) with a server-side salt before storage.
 */
export class BeaconController {
  protected log = $logger();
  protected beacons = $repository(beacons);
  protected campaigns = $repository(campaigns);
  protected quests = $repository(quests);
  protected fileRepo = $repository(files);
  protected rateLimiter = $inject(BeaconRateLimiter);
  protected security = $inject(AppSecurityProvider);
  protected fileService = $inject(FileService);
  protected fileSystem = $inject(FileSystemProvider);

  /**
   * Bucket for beacon screenshots. JPEG-only and capped at 1.5 MB so a single
   * widget submission can't smuggle in arbitrarily large payloads. MIME-type
   * validation alone is weak (it can be spoofed by the client); we also check
   * the JPEG magic bytes (`FF D8 FF`) at upload time.
   */
  screenshotBucket = $bucket({
    name: "beacon-screenshots",
    maxSize: 1.5,
    mimeTypes: ["image/jpeg"],
  });

  /**
   * Daily cap on beacons created per campaign per 24h.
   * Exposed as a protected field so tests can lower it via subclassing if needed.
   */
  protected dailyCap = 1000;

  submit = $action({
    method: "POST",
    path: "/c/:campaignId/beacons",
    schema: {
      params: t.object({ campaignId: t.integer() }),
      query: t.object({ t: t.string() }),
      headers: t.object({
        origin: t.optional(t.string()),
        "x-forwarded-for": t.optional(t.string()),
        "x-real-ip": t.optional(t.string()),
      }),
      body: beaconBodySchema,
      response: t.object({ id: t.integer() }),
    },
    handler: async (req) => {
      const { params, query, headers, body, ip } = req;

      const { campaign } = await this.verifyPublicAccess(
        params.campaignId,
        query.t,
        headers.origin,
      );
      const settings = campaign.beacons!;

      const clientIp = this.resolveIp(ip, headers);
      const ipHash = this.hashIp(clientIp);

      const limit = settings.rateLimitPerMin ?? DEFAULT_RATE_LIMIT;
      if (!this.rateLimiter.checkPerMinute(params.campaignId, ipHash, limit)) {
        throw new HttpError({ status: 429, message: "Rate limit exceeded" });
      }
      const underCap = await this.rateLimiter.checkDailyCap(
        params.campaignId,
        this.dailyCap,
      );
      if (!underCap) {
        throw new HttpError({ status: 429, message: "Daily cap exceeded" });
      }

      if (body.screenshotFileId) {
        const file = await this.fileRepo
          .findById(body.screenshotFileId)
          .catch(() => undefined);
        if (!file) {
          throw new BadRequestError("Screenshot file not found");
        }
      }

      const created = await this.beacons.create({
        campaignId: params.campaignId,
        title: body.title.slice(0, 200),
        description: body.description.slice(0, 10_000),
        reportType: body.reportType,
        reporterEmail: body.reporterEmail,
        status: "new",
        context: body.context,
        screenshotFileId: body.screenshotFileId,
        ipHash,
      });

      return { id: created.id };
    },
  });

  /**
   * Public screenshot upload endpoint for the Beacons widget.
   *
   * Mirrors `submit`'s auth checks (campaign+enabled, token, origin) but does
   * NOT touch the rate limiter — the matching `submit` call already pays that
   * cost, and counting both would double-charge a single user report.
   *
   * Magic-byte check on the leading 3 bytes (`FF D8 FF`) catches clients that
   * spoof the MIME type. `$bucket`'s own MIME check still runs as a second
   * line of defense.
   */
  uploadScreenshot = $action({
    name: "beaconUploadScreenshot",
    method: "POST",
    path: "/c/:campaignId/beacons/screenshot",
    schema: {
      params: t.object({ campaignId: t.integer() }),
      query: t.object({ t: t.string() }),
      headers: t.object({
        origin: t.optional(t.string()),
      }),
      body: t.object({
        file: t.file(),
      }),
      response: t.object({ fileId: t.uuid() }),
    },
    handler: async ({ params, query, headers, body }) => {
      await this.verifyPublicAccess(params.campaignId, query.t, headers.origin);

      const buffer = Buffer.from(await body.file.arrayBuffer());
      if (
        buffer.length < 3 ||
        buffer[0] !== 0xff ||
        buffer[1] !== 0xd8 ||
        buffer[2] !== 0xff
      ) {
        throw new BadRequestError("File is not a valid JPEG");
      }

      const reusable = this.fileSystem.createFile({
        buffer,
        name: body.file.name,
        type: body.file.type,
      });
      const file = await this.fileService.uploadFile(reusable, {
        bucket: this.screenshotBucket.name,
      });

      return { fileId: file.id };
    },
  });

  /**
   * List beacons for a campaign, filtered by status. Owner-only.
   *
   * `status=all` returns every status. Default `status=new` so the inbox view
   * doesn't drown the owner in already-triaged items.
   */
  list = $action({
    name: "beaconList",
    use: [$secure({ permissions: ["campaign:read"] })],
    method: "GET",
    path: "/campaigns/:campaignId/beacons",
    schema: {
      params: t.object({ campaignId: t.integer() }),
      query: t.object({
        status: t.optional(
          t.enum(["new", "promoted", "discarded", "all"], { mode: "text" }),
        ),
      }),
      response: t.object({ items: t.array(beaconResourceSchema) }),
    },
    handler: async ({ params, query, user }) => {
      await this.ensureOwner(params.campaignId, user);

      const status = query.status ?? "new";
      const where = this.beacons.createQueryWhere();
      where.campaignId = { eq: params.campaignId };
      if (status !== "all") {
        where.status = { eq: status };
      }

      const items = await this.beacons.findMany({
        where,
        orderBy: [{ column: "createdAt", direction: "desc" }],
      });

      return { items: items.map((b) => this.toResource(b)) };
    },
  });

  /**
   * Fetch a single beacon by id, scoped to its campaign. Owner-only.
   */
  detail = $action({
    name: "beaconDetail",
    use: [$secure({ permissions: ["campaign:read"] })],
    method: "GET",
    path: "/campaigns/:campaignId/beacons/:beaconId",
    schema: {
      params: t.object({
        campaignId: t.integer(),
        beaconId: t.integer(),
      }),
      response: beaconResourceSchema,
    },
    handler: async ({ params, user }) => {
      await this.ensureOwner(params.campaignId, user);
      const beacon = await this.loadBeacon(params.campaignId, params.beaconId);
      return this.toResource(beacon);
    },
  });

  /**
   * Promote a beacon into a quest. Creates a `quests` row, marks the beacon
   * as `promoted` and links the two via `promotedQuestId`. Owner-only.
   */
  promote = $action({
    name: "beaconPromote",
    use: [$secure({ permissions: ["campaign:update"] })],
    method: "POST",
    path: "/campaigns/:campaignId/beacons/:beaconId/promote",
    schema: {
      params: t.object({
        campaignId: t.integer(),
        beaconId: t.integer(),
      }),
      body: t.object({
        title: t.string({ minLength: 1, maxLength: 200 }),
        description: t.string({ minLength: 1, maxLength: 10_000 }),
        zone: t.string({ minLength: 1 }),
        priority: t.enum(["optional", "low", "medium", "high"], {
          mode: "text",
        }),
        difficulty: t.integer({ minimum: 1, maximum: 5 }),
        chapterId: t.optional(t.integer()),
      }),
      response: t.object({ questId: t.integer() }),
    },
    handler: async ({ params, body, user }) => {
      await this.ensureOwner(params.campaignId, user);
      const beacon = await this.loadBeacon(params.campaignId, params.beaconId);

      if (beacon.status !== "new") {
        throw new BadRequestError("Beacon already triaged");
      }

      const quest = await this.quests.create({
        campaignId: params.campaignId,
        title: body.title,
        description: body.description,
        zone: body.zone,
        priority: body.priority,
        difficulty: body.difficulty,
        chapterId: body.chapterId,
        createdBy: user.id,
        objectives: [],
        history: [],
        attachments: [],
      });

      await this.beacons.updateById(beacon.id, {
        status: "promoted",
        promotedQuestId: quest.id,
      });

      return { questId: quest.id };
    },
  });

  /**
   * Discard a beacon — soft state transition, the row remains for audit.
   * Owner-only.
   */
  discard = $action({
    name: "beaconDiscard",
    use: [$secure({ permissions: ["campaign:update"] })],
    method: "POST",
    path: "/campaigns/:campaignId/beacons/:beaconId/discard",
    schema: {
      params: t.object({
        campaignId: t.integer(),
        beaconId: t.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.ensureOwner(params.campaignId, user);
      const beacon = await this.loadBeacon(params.campaignId, params.beaconId);

      await this.beacons.updateById(beacon.id, { status: "discarded" });
      return { ok: true };
    },
  });

  /**
   * Soft-delete a beacon row. Owner-only.
   */
  remove = $action({
    name: "beaconRemove",
    use: [$secure({ permissions: ["campaign:delete"] })],
    method: "DELETE",
    path: "/campaigns/:campaignId/beacons/:beaconId",
    schema: {
      params: t.object({
        campaignId: t.integer(),
        beaconId: t.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.ensureOwner(params.campaignId, user);
      const beacon = await this.loadBeacon(params.campaignId, params.beaconId);
      await this.beacons.deleteById(beacon.id);
      return { ok: true };
    },
  });

  /**
   * Serve the stage-1 widget loader (`bt.js`).
   *
   * Validates the token (constant-time) against `campaign.beacons.publicToken`
   * — but never 404s on failure. A wrong token or a disabled campaign returns
   * a tiny no-op script so an old `<script>` tag embedded on a customer site
   * silently degrades instead of spamming the console with HTTP errors.
   *
   * The emitted script is a readable IIFE that injects a shadow-DOM button,
   * lazy-loads `bt-dialog.js` on first click, and posts the form payload back
   * via an iframe at `/c/:campaignId/beacons/form?t=<token>`.
   */
  serveLoader = $action({
    name: "beaconServeLoader",
    method: "GET",
    path: "/c/:campaignId/bt.js",
    schema: {
      params: t.object({ campaignId: t.integer() }),
      query: t.object({ t: t.string() }),
      response: t.string(),
    },
    handler: async ({ params, query, reply }) => {
      reply.setHeader("content-type", "application/javascript; charset=utf-8");
      reply.setHeader("cache-control", "public, max-age=300");

      const campaign = await this.campaigns
        .findById(params.campaignId)
        .catch(() => undefined);

      if (
        !campaign ||
        !campaign.beacons?.enabled ||
        !this.constantTimeEq(query.t, campaign.beacons.publicToken)
      ) {
        return "(function(){console.warn('[beacons] disabled or invalid token');})();";
      }

      return this.renderLoaderScript(params.campaignId, query.t);
    },
  });

  /**
   * Serve the stage-2 capture script (`bt-dialog.js`). No token check: this
   * file is only referenced lazily by the stage-1 loader after a successful
   * token validation, and serves a static module shell.
   */
  serveDialog = $action({
    name: "beaconServeDialog",
    method: "GET",
    path: "/c/:campaignId/bt-dialog.js",
    schema: {
      params: t.object({ campaignId: t.integer() }),
      response: t.string(),
    },
    handler: async ({ reply }) => {
      reply.setHeader("content-type", "application/javascript; charset=utf-8");
      reply.setHeader("cache-control", "public, max-age=300");
      return this.renderDialogScript();
    },
  });

  /**
   * Build the stage-1 loader IIFE. Bakes campaign id, public token, and the
   * server's public origin into the script. Falls back to `location.origin`
   * on the client when `PUBLIC_URL` isn't set, so dev and self-hosted
   * deployments both work without extra config.
   */
  protected renderLoaderScript(campaignId: number, token: string): string {
    const publicOrigin = process.env.PUBLIC_URL ?? "";
    const cfg = JSON.stringify({
      campaignId,
      token,
      origin: publicOrigin,
    });
    return `(function(){
  var CFG = ${cfg};
  var origin = CFG.origin || (typeof location !== 'undefined' ? location.origin : '');

  function mount(){
    if (document.getElementById('alepha-beacon-host')) return;
    var host = document.createElement('div');
    host.id = 'alepha-beacon-host';
    host.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;';
    var root = host.attachShadow ? host.attachShadow({mode:'open'}) : host;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Report';
    btn.style.cssText = 'all:initial;font:600 13px/1 system-ui,sans-serif;background:#111;color:#fff;border-radius:999px;padding:10px 16px;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.2);';
    btn.addEventListener('click', open);
    root.appendChild(btn);
    document.body.appendChild(host);
  }

  var dialogPromise = null;
  function loadDialog(){
    if (!dialogPromise) {
      dialogPromise = import(origin + '/c/' + CFG.campaignId + '/bt-dialog.js');
    }
    return dialogPromise;
  }

  function open(){
    loadDialog().then(function(mod){
      if (mod && typeof mod.openBeaconDialog === 'function') {
        mod.openBeaconDialog({
          campaignId: CFG.campaignId,
          token: CFG.token,
          origin: origin
        });
      } else {
        openFallback();
      }
    }).catch(function(){
      openFallback();
    });
  }

  function openFallback(){
    var existing = document.getElementById('alepha-beacon-frame');
    if (existing) return;
    var frame = document.createElement('iframe');
    frame.id = 'alepha-beacon-frame';
    frame.src = origin + '/c/' + CFG.campaignId + '/beacons/form?t=' + encodeURIComponent(CFG.token);
    frame.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:2147483647;background:rgba(0,0,0,.3);';
    document.body.appendChild(frame);
    function onReady(ev){
      if (!ev.data || ev.data.type !== 'alepha-beacon:ready') return;
      if (ev.source !== frame.contentWindow) return;
      frame.contentWindow.postMessage({
        type: 'alepha-beacon:context',
        context: {
          url: location.href,
          path: location.pathname,
          userAgent: navigator.userAgent,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          locale: navigator.language,
          referrer: document.referrer || undefined,
        },
      }, '*');
    }
    function onClose(ev){
      if (!ev.data || ev.data.type !== 'alepha-beacon:close') return;
      window.removeEventListener('message', onReady);
      window.removeEventListener('message', onClose);
      frame.remove();
    }
    window.addEventListener('message', onReady);
    window.addEventListener('message', onClose);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();`;
  }

  /**
   * Build the stage-2 capture module. Uses dynamic import of `html2canvas`
   * from esm.sh — keeps the server stateless and lets the browser cache the
   * library across page loads. The exported `openBeaconDialog` is invoked by
   * the loader on first user click.
   */
  protected renderDialogScript(): string {
    return `const HTML2CANVAS = 'https://esm.sh/html2canvas@1.4.1';

export async function openBeaconDialog(cfg){
  if (document.getElementById('alepha-beacon-frame')) return;

  let screenshotBlob = null;
  try {
    const mod = await import(HTML2CANVAS);
    const html2canvas = mod.default || mod;
    const canvas = await html2canvas(document.body, {
      useCORS: true,
      logging: false,
      scale: Math.min(window.devicePixelRatio || 1, 2),
    });
    screenshotBlob = await new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.8);
    });
  } catch (err) {
    console.warn('[beacons] screenshot capture failed', err);
  }

  const frame = document.createElement('iframe');
  frame.id = 'alepha-beacon-frame';
  frame.src = cfg.origin + '/c/' + cfg.campaignId + '/beacons/form?t=' + encodeURIComponent(cfg.token);
  frame.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:2147483647;background:rgba(0,0,0,.3);';
  document.body.appendChild(frame);

  function onReady(ev){
    if (!ev.data || ev.data.type !== 'alepha-beacon:ready') return;
    if (ev.source !== frame.contentWindow) return;
    frame.contentWindow.postMessage({
      type: 'alepha-beacon:context',
      context: {
        url: location.href,
        path: location.pathname,
        userAgent: navigator.userAgent,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        locale: navigator.language,
        referrer: document.referrer || undefined,
      },
      screenshot: screenshotBlob,
    }, '*');
  }

  function onClose(ev){
    if (!ev.data || ev.data.type !== 'alepha-beacon:close') return;
    window.removeEventListener('message', onReady);
    window.removeEventListener('message', onClose);
    frame.remove();
  }

  window.addEventListener('message', onReady);
  window.addEventListener('message', onClose);
}
`;
  }

  /**
   * Regenerate the public ingest token for a campaign's Beacons settings.
   * Owner-only. Returns the freshly-minted token so the owner can update the
   * widget snippet in one round-trip.
   */
  regenerateToken = $action({
    name: "beaconRegenerateToken",
    use: [$secure({ permissions: ["campaign:update"] })],
    method: "POST",
    path: "/campaigns/:campaignId/beacons/regenerate-token",
    schema: {
      params: t.object({ campaignId: t.integer() }),
      response: t.object({ publicToken: t.string() }),
    },
    handler: async ({ params, user }) => {
      const { campaign } = await this.ensureOwner(params.campaignId, user);

      if (!campaign.beacons) {
        throw new BadRequestError("Beacons not configured for this campaign");
      }

      const publicToken = BeaconController.generateToken();
      await this.campaigns.updateById(campaign.id, {
        beacons: {
          ...campaign.beacons,
          publicToken,
        },
      });

      return { publicToken };
    },
  });

  /**
   * Shared guard for public ingest endpoints. Validates that the campaign
   * exists, has beacons enabled, the token matches (constant-time) and the
   * origin is allow-listed. Throws the same errors `submit` used to throw
   * inline, so behaviour is unchanged for that path.
   */
  protected async verifyPublicAccess(
    campaignId: number,
    token: string,
    origin: string | undefined,
  ): Promise<{ campaign: Campaign }> {
    const campaign = await this.campaigns
      .findById(campaignId)
      .catch(() => undefined);
    if (!campaign || !campaign.beacons?.enabled) {
      throw new NotFoundError("Beacon endpoint not found");
    }
    const settings = campaign.beacons;

    if (!this.constantTimeEq(token, settings.publicToken)) {
      throw new UnauthorizedError("Invalid token");
    }

    if (!this.originAllowed(origin ?? "", settings.allowedOrigins)) {
      throw new ForbiddenError("Origin not allowed");
    }

    return { campaign };
  }

  /**
   * Owner guard. Mirrors the pattern used by `QuestController.deleteQuest`:
   * resolves the campaign via `AppSecurityProvider.checkOwnership` (which
   * throws `DbEntityNotFoundError` for missing campaigns) and rejects when
   * the user is not the creator.
   */
  protected async ensureOwner(campaignId: number, user: UserAccountToken) {
    const guard = await this.security.checkOwnership(campaignId, user);
    if (guard.campaign.createdBy !== user.id) {
      throw new ForbiddenError("Only the campaign owner can manage beacons");
    }
    return guard;
  }

  /**
   * Load a beacon by id, asserting it belongs to the expected campaign.
   * Returns `NotFoundError` rather than leaking cross-campaign lookups.
   */
  protected async loadBeacon(
    campaignId: number,
    beaconId: number,
  ): Promise<Beacon> {
    const beacon = await this.beacons.findOne({
      where: {
        id: { eq: beaconId },
        campaignId: { eq: campaignId },
      },
    });
    if (!beacon) {
      throw new NotFoundError("Beacon not found");
    }
    return beacon;
  }

  /**
   * Map a beacon entity to its owner-facing DTO, computing a screenshot URL
   * when a file has been attached.
   */
  protected toResource(beacon: Beacon): BeaconResource {
    return {
      ...beacon,
      screenshotUrl: beacon.screenshotFileId
        ? `/api/files/${beacon.screenshotFileId}`
        : undefined,
    };
  }

  /**
   * Constant-time string equality. Falls back to false on length mismatch
   * (timingSafeEqual throws on differing lengths).
   */
  protected constantTimeEq(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) {
      return false;
    }
    return timingSafeEqual(ab, bb);
  }

  /**
   * Check whether an origin (full URL like `https://app.example.com`) is allowed.
   * Supports `*.domain` wildcard entries — `*.example.com` matches both
   * `example.com` and any sub-domain of `example.com`.
   */
  protected originAllowed(origin: string, allow: string[]): boolean {
    let host: string;
    try {
      host = new URL(origin).hostname;
    } catch {
      return false;
    }
    return allow.some((rule) => {
      if (rule.startsWith("*.")) {
        const suffix = rule.slice(2);
        return host === suffix || host.endsWith(`.${suffix}`);
      }
      return host === rule;
    });
  }

  /**
   * Resolve the client IP. Prefers the `request.ip` (already parsed by the
   * server when `TRUST_PROXY` is set), falling back to explicit proxy headers
   * for environments where `TRUST_PROXY` is not configured.
   */
  protected resolveIp(
    ip: string | undefined,
    headers: { "x-forwarded-for"?: string; "x-real-ip"?: string },
  ): string {
    if (ip) {
      return ip;
    }
    const fwd = headers["x-forwarded-for"];
    if (fwd) {
      const first = fwd.split(",")[0]?.trim();
      if (first) {
        return first;
      }
    }
    if (headers["x-real-ip"]) {
      return headers["x-real-ip"];
    }
    return "0.0.0.0";
  }

  /**
   * Hash an IP with the server-side salt. Salt comes from the `BEACONS_IP_SALT`
   * env var; falls back to a dev-only default.
   */
  protected hashIp(ip: string): string {
    const salt = process.env.BEACONS_IP_SALT ?? "dev-salt-change-me";
    return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
  }

  /**
   * Generate a fresh public token. Used when creating/regenerating a campaign's
   * Beacons settings.
   */
  static generateToken(): string {
    return `pk_${randomBytes(24).toString("hex")}`;
  }
}
