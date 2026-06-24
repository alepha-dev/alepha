import { $inject, z } from "alepha";
import { $route, HttpError } from "alepha/server";
import { sigilIngestBodySchema } from "../schemas/sigilIngestBody.ts";
import { SigilIngestRunner } from "../services/SigilIngestRunner.ts";
import { SigilService } from "../services/SigilService.ts";

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
  protected sigils = $inject(SigilService);
  protected runner = $inject(SigilIngestRunner);

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
      params: z.object({ id: z.string() }),
      body: sigilIngestBodySchema,
    },
    handler: async (request) => {
      const { params, body, reply } = request;

      const outcome = await this.runner.run(params.id, body);
      if (outcome === "not-found") {
        throw new HttpError({ status: 404, message: "Sigil not found" });
      }
      if (outcome === "feature-off") {
        reply.setStatus(403);
        return;
      }

      reply.setStatus(204);
    },
  });

  /**
   * `GET /sigils/:id/campaign` — public sigil → campaign resolver.
   *
   * Maps a sigil UUID to the campaign it belongs to so the first-party
   * petition request page (driven off an external "report a bug" link that
   * only carries the sigil id) can redirect the visitor to
   * `/c/:campaignId/request`. Public + unauthenticated — the sigil UUID is
   * the sole credential, exactly like the ingest endpoint.
   *
   * Resolution mirrors the ingest path: `SigilService.findForIngest(:id)` →
   * 404 with the same message when the sigil cannot be resolved.
   *
   * `$route` (not `$action`) — lives at the ROOT path, not under `/api`.
   */
  getSigilCampaign = $route({
    method: "GET",
    path: "/sigils/:id/campaign",
    schema: {
      params: z.object({ id: z.string() }),
      response: z.object({ campaignId: z.integer() }),
    },
    handler: async ({ params }) => {
      const sigil = await this.sigils.findForIngest(params.id);
      if (!sigil) {
        throw new HttpError({ status: 404, message: "Sigil not found" });
      }
      return { campaignId: sigil.campaignId };
    },
  });
}
