import { $inject, Alepha, z } from "alepha";
import { $secure, currentUserAtom } from "alepha/security";
import { $route, ForbiddenError } from "alepha/server";

import { otaPublishResultSchema } from "../schemas/otaPublishResultSchema.ts";
import { OtaPublishService } from "../services/OtaPublishService.ts";

/**
 * `POST /ota/bundles`, where `alepha capacitor release` publishes: a
 * multipart body with two files: the release `manifest` (JSON) and the
 * encrypted `bundle`.
 *
 * Machine credentials only: an `alepha/api/keys` key holding `ota:release`
 * AND listed on the app it publishes to. A key with the permission and no
 * binding to this app is refused, so one leaked key cannot publish to every
 * app on the server. The admin's own upload goes through `OtaAdminController`
 * with a signed-in session instead.
 */
export class OtaPublishController {
  protected readonly publisher = $inject(OtaPublishService);
  protected readonly alepha = $inject(Alepha);

  public readonly publish = $route({
    method: "POST",
    path: "/ota/bundles",
    use: [$secure({ permissions: ["ota:release"] })],
    schema: {
      body: z.object({
        manifest: z.file({ maxBytes: 20_000 }),
        bundle: z.file({ maxBytes: 100_000_000 }),
      }),
      response: otaPublishResultSchema,
    },
    handler: async ({ body, reply }) => {
      const manifest = this.publisher.parseManifest(await body.manifest.text());
      const app = await this.publisher.appOf(manifest);
      const user = this.alepha.store.get(currentUserAtom);
      const credential = user?.credential;
      if (
        credential?.type !== "api-key" ||
        !app.publisherKeyIds.includes(credential.id)
      ) {
        throw new ForbiddenError(
          `This credential may not publish to ${app.appId}: use an API key listed on the app`,
        );
      }
      const { bundle, created } = await this.publisher.publish(
        manifest,
        new Uint8Array(await body.bundle.arrayBuffer()),
      );
      reply.status = created ? 201 : 200;
      return {
        id: bundle.id,
        version: bundle.version,
        platform: bundle.platform,
        channel: bundle.channel,
        created,
      };
    },
  });
}
