import { $inject, t } from "alepha";
import { FileService } from "alepha/api/files";
import { $logger } from "alepha/logger";
import { $repository, $sequence } from "alepha/orm";
import { $route, HttpError } from "alepha/server";
import { FileSystemProvider } from "alepha/system";
import { petitions } from "../entities/petitions.ts";
import { BeaconIngestService } from "../services/BeaconIngestService.ts";
import { BlightIngestService } from "../services/BlightIngestService.ts";
import { PetitionRateLimiter } from "../services/PetitionRateLimiter.ts";
import { SigilIngestSupport } from "../services/SigilIngestSupport.ts";
import { SigilService } from "../services/SigilService.ts";
import { VitalsIngestService } from "../services/VitalsIngestService.ts";

/**
 * Body schema for `POST /sigils/:id/ingest`.
 *
 * All three capability buckets are optional: a partner server sends only
 * what it has. `country` and `visitor` are stamped by the partner and apply
 * to the whole batch (the partner already resolved country and computed the
 * daily visitor hash server-side).
 *
 * Length constraints mirror the `@alepha/sigil` schemas but are declared
 * locally to avoid importing from `@alepha/sigil` (that barrel pulls React).
 */
const sigilIngestBodySchema = t.object({
  /**
   * Pageview hits. Each item carries the path the user visited.
   * The `beacon` capability gate must pass for these to be recorded.
   */
  views: t.optional(
    t.array(
      t.object({
        path: t.string({ maxLength: 5_000 }),
      }),
      { maxItems: 50 },
    ),
  ),
  /**
   * Crash / error events. Each item carries name, message, stack, and
   * optional sourceUrl. The `blights` capability gate must pass.
   */
  errors: t.optional(
    t.array(
      t.object({
        name: t.optional(t.string({ maxLength: 500 })),
        message: t.optional(t.string({ maxLength: 5_000 })),
        stack: t.optional(t.string({ maxLength: 20_000 })),
        sourceUrl: t.optional(t.string({ maxLength: 5_000 })),
        origin: t.optional(t.enum(["client", "server"], { mode: "text" })),
      }),
      { maxItems: 20 },
    ),
  ),
  /**
   * Web-Vitals samples. Each item carries path, metric name, and raw value.
   * The `vitals` capability gate must pass.
   */
  vitals: t.optional(
    t.array(
      t.object({
        path: t.string({ maxLength: 5_000 }),
        metric: t.string({ maxLength: 50 }),
        value: t.number(),
      }),
      { maxItems: 100 },
    ),
  ),
  /**
   * ISO 3166-1 alpha-2 country code stamped by the partner server (e.g.
   * from `cf-ipcountry`, GeoIP, or a CDN header). Defaults to `"ZZ"` when
   * absent. Applied to all views in the batch.
   */
  country: t.optional(t.string({ maxLength: 8 })),
  /**
   * Partner-computed daily visitor hash. When present it is stored as-is as
   * `sessionHash` in `sigil_unique_visitors` (the partner already derived
   * the day-scoped hash from the visitor's IP + UA). When absent, the
   * unique-visitor insert is skipped.
   */
  visitor: t.optional(t.string({ maxLength: 256 })),
});

/**
 * UUID-keyed, server-to-server ingest endpoint: `POST /sigils/:id/ingest`.
 *
 * This endpoint is the **trusted partner-server** surface — the counterpart
 * to the browser-embed endpoints (`POST /sigils/:id/beacon`,
 * `POST /sigils/:id/blights`). It accepts a single batched payload covering
 * all three capabilities (views, errors, vitals) in one round-trip.
 *
 * **Security model:** the sigil UUID is the ONLY credential. There is no
 * `ingestKey`, no `Origin` allow-list, no UA filter, no CORS — this endpoint
 * is called server-to-server (the sigil UUID is a server-held secret).
 * Gating is:
 *
 * 1. Sigil resolves from `:id` — 404 if missing.
 * 2. Campaign `features.sigils` master toggle — 403 if off.
 * 3. Per-capability: `features.beacon` + `kinds.includes("beacon")` for
 *    views; `features.blights` + `kinds.includes("blights")` for errors;
 *    `features.vitals` + `kinds.includes("vitals")` for vitals.
 *
 * On success the handler returns 204 (no content) — the partner is
 * fire-and-forget, same as the embed endpoints.
 *
 * `$route` (not `$action`) — lives at the ROOT path, not under `/api`,
 * exactly like `VersionController`.
 */
export class SigilIngestController {
  protected log = $logger();
  protected sigils = $inject(SigilService);
  protected beacons = $inject(BeaconIngestService);
  protected blights = $inject(BlightIngestService);
  protected vitals = $inject(VitalsIngestService);
  protected support = $inject(SigilIngestSupport);
  protected petitionsRepo = $repository(petitions);
  protected rateLimiter = $inject(PetitionRateLimiter);
  protected fileService = $inject(FileService);
  protected fileSystem = $inject(FileSystemProvider);

  /**
   * Shares the per-campaign shortId sequence with {@link PetitionController}.
   * The name must match the property key used in `PetitionController`
   * (`petitionShortId`) so both paths draw from the same counter table rows.
   */
  protected petitionShortId = $sequence({ name: "petitionShortId" });

  /**
   * `POST /sigils/:id/ingest` — batched, trusted server-to-server ingest.
   *
   * Resolves the sigil, runs the master gate and per-capability gates, then
   * dispatches each capability bucket to its dedicated ingest service.
   * Returns 204 regardless of per-item outcome — the partner is
   * fire-and-forget.
   */
  ingest = $route({
    method: "POST",
    path: "/sigils/:id/ingest",
    schema: {
      params: t.object({ id: t.string() }),
      body: sigilIngestBodySchema,
    },
    handler: async (request) => {
      const { params, body, reply } = request;

      // Gate 1 — sigil resolves.
      const sigil = await this.sigils.findForEmbed(params.id);
      if (!sigil) {
        throw new HttpError({ status: 404, message: "Sigil not found" });
      }

      const kinds: string[] = sigil.kinds ?? [];

      // Gate 2 — master toggle: features.sigils must be ON.
      const sigilsOn = await this.support.isFeatureOn(
        sigil.campaignId,
        "sigils",
      );
      if (!sigilsOn) {
        reply.setStatus(403);
        return;
      }

      // Gate 3a — views: features.beacon + kinds.includes("beacon").
      if (body.views && body.views.length > 0) {
        const beaconOn = await this.support.isFeatureOn(
          sigil.campaignId,
          "beacon",
        );
        if (beaconOn && kinds.includes("beacon")) {
          for (const view of body.views) {
            try {
              await this.beacons.ingestView(
                sigil.id,
                view.path,
                body.country,
                body.visitor,
              );
            } catch (err) {
              this.log.warn("Ingest view failed", err);
            }
          }
        }
      }

      // Gate 3b — errors: features.blights + kinds.includes("blights").
      if (body.errors && body.errors.length > 0) {
        const blightsOn = await this.support.isFeatureOn(
          sigil.campaignId,
          "blights",
        );
        if (blightsOn && kinds.includes("blights")) {
          for (const error of body.errors) {
            try {
              await this.blights.ingestEventTrusted(sigil.id, error);
            } catch (err) {
              this.log.warn("Ingest error failed", err);
            }
          }
        }
      }

      // Gate 3c — vitals: features.vitals + kinds.includes("vitals").
      if (body.vitals && body.vitals.length > 0) {
        const vitalsOn = await this.support.isFeatureOn(
          sigil.campaignId,
          "vitals",
        );
        if (vitalsOn && kinds.includes("vitals")) {
          try {
            // body.vitals metric is `string` here (schema can't know the
            // VitalMetric enum without importing @alepha/sigil which pulls
            // React). VitalsIngestService silently drops unknown metrics, so
            // the cast is safe — invalid values are filtered inside the service.
            // biome-ignore lint/suspicious/noExplicitAny: see above
            await this.vitals.ingestVitals(sigil.id, body.vitals as any);
          } catch (err) {
            this.log.warn("Ingest vitals failed", err);
          }
        }
      }

      reply.setStatus(204);
    },
  });

  /**
   * `POST /sigils/:id/petition` — anonymous, UUID-keyed multipart petition.
   *
   * The partner app's sigil proxy forwards a user-submitted form to this
   * endpoint. There is no Lore session, no `Origin` allow-list, no CORS —
   * the sigil UUID is the sole server-to-server credential.
   *
   * **Security model:**
   * 1. Sigil resolves from `:id` — 404 if missing.
   * 2. `features.sigils` master toggle — 403 if off.
   * 3. `features.embeddedPetitions` — 403 if off.
   * 4. `sigil.kinds.includes("petition")` — 403 if absent.
   * 5. Per-sigil-per-day rate cap via {@link PetitionRateLimiter}.
   *
   * The petition is anonymous — `reporterEmail` comes from the forwarded form
   * (attacker-controlled, persisted verbatim, rendered as escaped plain text
   * only — see folio #12). No Lore user is resolved or required.
   *
   * If a `screenshot` file is present it is validated and stored into the
   * `petition-attachments` bucket via {@link FileService} **without** an owner
   * stamp (trusted server path — there is no user to attribute it to).
   *
   * Returns `{ id }` — the internal petition row id.
   */
  submitSigilPetition = $route({
    method: "POST",
    path: "/sigils/:id/petition",
    schema: {
      params: t.object({ id: t.string() }),
      body: t.object({
        title: t.string({ minLength: 1, maxLength: 200 }),
        description: t.string({ minLength: 1, maxLength: 10_000 }),
        /**
         * Petition type hint forwarded from the form. Mapped to a `type=…` tag
         * on the petition row so the campaign owner can filter. The petition
         * entity has no dedicated `type` column — tags are the canonical
         * container for this kind of metadata. If the field is absent no tag is
         * added.
         */
        type: t.optional(t.enum(["bug", "feature"], { mode: "text" })),
        /**
         * URL of the page the form was submitted from. Stored in
         * `source.hostUrl`. Attacker-controlled — render as escaped plain text.
         */
        hostUrl: t.string({ maxLength: 2000 }),
        /**
         * Path component of the page URL. Stored in `source.hostPath`.
         * Attacker-controlled — render as escaped plain text.
         */
        hostPath: t.string({ maxLength: 2000 }),
        /**
         * Partner-supplied reporter email. May be absent (anonymous path).
         * Attacker-controlled — render as escaped plain text only.
         */
        reporterEmail: t.optional(t.string({ maxLength: 320 })),
        /**
         * Optional screenshot attachment. Validated (MIME + extension + size)
         * and stored in the `petition-attachments` bucket.
         */
        screenshot: t.optional(t.file()),
      }),
      response: t.object({ id: t.integer() }),
    },
    handler: async ({ params, body }) => {
      // Gate 1 — sigil resolves.
      const sigil = await this.sigils.findForEmbed(params.id);
      if (!sigil) {
        throw new HttpError({ status: 404, message: "Sigil not found" });
      }

      // Gate 2 — master toggle.
      const sigilsOn = await this.support.isFeatureOn(
        sigil.campaignId,
        "sigils",
      );
      if (!sigilsOn) {
        throw new HttpError({
          status: 403,
          message: "Sigils are disabled for this campaign",
        });
      }

      // Gate 3 — embedded-petition capability.
      const embeddedPetitionsOn = await this.support.isFeatureOn(
        sigil.campaignId,
        "embeddedPetitions",
      );
      if (!embeddedPetitionsOn) {
        throw new HttpError({
          status: 403,
          message: "Embedded petitions are disabled for this campaign",
        });
      }

      // Gate 4 — sigil grants "petition" kind.
      if (!(sigil.kinds ?? []).includes("petition")) {
        throw new HttpError({
          status: 403,
          message: "Sigil does not grant the petition capability",
        });
      }

      // Gate 5 — per-sigil-per-day rate cap.
      await this.rateLimiter.assertSigilPetitionAllowed(sigil.id);

      // Optional screenshot — validate and store before creating the petition
      // row so the file id is available for the `attachments` array. No user
      // is passed (trusted server path — there is no Lore session), so no
      // per-user ownership stamp is set. The `assertAttachmentsBelongToUser`
      // check in `PetitionController` is bypassed on this path by design.
      let attachments: string[] = [];
      if (body.screenshot) {
        const limits = this.rateLimiter.options();
        const file = body.screenshot;

        if (file.size > limits.maxFileSizeBytes) {
          throw new HttpError({
            status: 400,
            message: `File too large (max ${Math.round(limits.maxFileSizeBytes / 1024 / 1024)} MB)`,
          });
        }

        if (!limits.allowedMimeTypes.includes(file.type)) {
          throw new HttpError({
            status: 400,
            message: `File type not allowed: ${file.type}`,
          });
        }

        const ext = this.extractExtension(file.name);
        if (!ext || !limits.allowedExtensions.includes(ext)) {
          throw new HttpError({
            status: 400,
            message: `File extension not allowed: .${ext ?? ""}`,
          });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const reusable = this.fileSystem.createFile({
          buffer,
          name: file.name,
          type: file.type,
        });

        const stored = await this.fileService.uploadFile(reusable, {
          bucket: PetitionRateLimiter.ATTACHMENT_BUCKET,
          // No `user` — this is the anonymous server-to-server path.
        });

        attachments = [stored.id];
      }

      // Build the `type` tag if the form supplied a type hint.
      const tags = body.type ? [`type=${body.type}`] : [];

      const shortId = await this.petitionShortId.next(String(sigil.campaignId));

      const created = await this.petitionsRepo.create({
        campaignId: sigil.campaignId,
        shortId,
        reporterEmail: body.reporterEmail ?? undefined,
        title: body.title.slice(0, 200),
        description: body.description.slice(0, 10_000),
        status: "pending",
        attachments,
        tags,
        source: {
          sigilId: sigil.id,
          hostUrl: body.hostUrl,
          hostPath: body.hostPath,
          userAgent: "",
        },
      });

      return { id: created.id };
    },
  });

  /**
   * Extract the lowercased file extension from a filename.
   * Returns `undefined` when the name has no dot or the dot is the last char.
   */
  protected extractExtension(name: string): string | undefined {
    const idx = name.lastIndexOf(".");
    if (idx < 0 || idx === name.length - 1) return undefined;
    return name.slice(idx + 1).toLowerCase();
  }
}
