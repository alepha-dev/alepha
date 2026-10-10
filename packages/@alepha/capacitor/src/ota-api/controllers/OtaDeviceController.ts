import { $inject, Alepha, z } from "alepha";
import { $repository } from "alepha/orm";
import { $route, type ServerRequest } from "alepha/server";
import { $rateLimit } from "alepha/server/rate-limit";

import { otaChannelGetResponseSchema } from "../../ota/protocol/otaChannelGetResponseSchema.ts";
import { otaChannelListResponseSchema } from "../../ota/protocol/otaChannelListResponseSchema.ts";
import { otaChannelSetResponseSchema } from "../../ota/protocol/otaChannelSetResponseSchema.ts";
import { otaDeviceSchema } from "../../ota/protocol/otaDeviceSchema.ts";
import { otaStatsRequestSchema } from "../../ota/protocol/otaStatsRequestSchema.ts";
import { otaUpdateResponseSchema } from "../../ota/protocol/otaUpdateResponseSchema.ts";
import { otaBundles } from "../entities/otaBundles.ts";
import { OtaDownloadLinks } from "../services/OtaDownloadLinks.ts";
import { OtaPublishService } from "../services/OtaPublishService.ts";
import { OtaUpdateService } from "../services/OtaUpdateService.ts";

/**
 * The endpoints the pinned updater calls, at the root under `/ota` (never
 * `/api`, which the `$action` dispatcher owns). Unauthenticated by nature: a
 * device has no account. So nothing here trusts what a device says, every
 * body is bounded by its schema, and each address is throttled.
 *
 * - `POST /ota/updates`: which bundle this device should run;
 * - `POST /ota/stats`: lifecycle telemetry, a batch;
 * - `POST|PUT|GET /ota/channel`: `setChannel()`, `getChannel()`,
 *   `listChannels()`;
 * - `GET /ota/bundles/:id/download?token=`: the encrypted bundle, behind a
 *   short-lived signed link.
 */
export class OtaDeviceController {
  protected readonly alepha = $inject(Alepha);
  protected readonly updates = $inject(OtaUpdateService);
  protected readonly links = $inject(OtaDownloadLinks);
  protected readonly publisher = $inject(OtaPublishService);
  protected readonly bundles = $repository(otaBundles);

  public readonly checkForUpdate = $route({
    method: "POST",
    path: "/ota/updates",
    use: [$rateLimit({ max: 120, windowMs: 60_000 })],
    schema: {
      body: otaDeviceSchema,
      response: otaUpdateResponseSchema,
    },
    handler: async (request) => {
      const answer = await this.updates.check(
        request.body,
        this.origin(request),
      );
      request.reply.status = answer.status;
      return answer.body;
    },
  });

  public readonly stats = $route({
    method: "POST",
    path: "/ota/stats",
    use: [$rateLimit({ max: 120, windowMs: 60_000 })],
    schema: {
      body: otaStatsRequestSchema,
      response: z.object({ status: z.text() }),
    },
    handler: async ({ body }) => {
      await this.updates.stats(Array.isArray(body) ? body : [body]);
      return { status: "ok" };
    },
  });

  public readonly setChannel = $route({
    method: "POST",
    path: "/ota/channel",
    use: [$rateLimit({ max: 30, windowMs: 60_000 })],
    schema: {
      body: otaDeviceSchema,
      response: otaChannelSetResponseSchema,
    },
    handler: async (request) => {
      const answer = await this.updates.setChannel(request.body);
      request.reply.status = answer.status;
      return answer.body;
    },
  });

  public readonly getChannel = $route({
    method: "PUT",
    path: "/ota/channel",
    use: [$rateLimit({ max: 30, windowMs: 60_000 })],
    schema: {
      body: otaDeviceSchema,
      response: otaChannelGetResponseSchema,
    },
    handler: ({ body }) => this.updates.getChannel(body),
  });

  public readonly listChannels = $route({
    method: "GET",
    path: "/ota/channel",
    use: [$rateLimit({ max: 30, windowMs: 60_000 })],
    schema: {
      // The plugin sends its whole device record as a query string; only
      // the app is needed to answer.
      query: z.object({ app_id: z.text() }),
      response: otaChannelListResponseSchema,
    },
    handler: ({ query }) => this.updates.listChannels(query.app_id),
  });

  public readonly download = $route({
    method: "GET",
    path: "/ota/bundles/:id/download",
    use: [$rateLimit({ max: 60, windowMs: 60_000 })],
    schema: {
      params: z.object({ id: z.uuid() }),
      query: z.object({ token: z.text({ maxLength: 256 }) }),
    },
    handler: async ({ params, query, reply }) => {
      const bundle = await this.bundles.findById(params.id);
      // One answer for every refusal: a link that does not verify says
      // nothing about whether the bundle exists.
      if (
        !bundle ||
        bundle.status !== "ready" ||
        !bundle.fileId ||
        !this.links.verify(bundle, query.token)
      ) {
        reply.status = 403;
        reply.setHeader("content-type", "application/json");
        return JSON.stringify({
          error: "invalid_link",
          message: "This download link is not valid",
        });
      }
      if (bundle.killedAt) {
        reply.status = 410;
        reply.setHeader("content-type", "application/json");
        return JSON.stringify({
          error: "killed",
          message: "This bundle was withdrawn",
        });
      }
      const file = await this.publisher.storage.download(bundle.fileId);
      reply.setHeader("cache-control", "private, no-store");
      reply.setHeader("content-type", "application/zip");
      reply.setHeader("content-length", String(bundle.size));
      return file.stream() as ReadableStream<Uint8Array>;
    },
  });

  /**
   * The origin download links are built on: `PUBLIC_URL` when the app sets
   * it, else the one this request arrived on.
   */
  protected origin(request: ServerRequest): string {
    const configured = String(this.alepha.env.PUBLIC_URL ?? "").replace(
      /\/+$/,
      "",
    );
    return configured || request.url.origin;
  }
}
