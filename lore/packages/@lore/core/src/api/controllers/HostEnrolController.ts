import { $inject, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { $route, UnauthorizedError } from "alepha/server";

import { hosts } from "../entities/hosts.ts";
import { hostEnrolExchangeSchema } from "../schemas/hostEnrolExchangeSchema.ts";
import { HostTokenService } from "../services/HostTokenService.ts";

/**
 * The exchange a freshly provisioned machine makes before it connects
 * (#Q3165): its one-time enrolment secret, read from cloud-init user data,
 * for the host's long-lived secret.
 *
 * ## Why an HTTP exchange, not a frame
 *
 * The websocket never carries a secret, and keeping it that way keeps the
 * wire as it is. `bay connector set <lore> enr_...` calls this, stores what
 * it answers (mode 0600) and only then dials the socket with it.
 *
 * ## Crash-safe by re-minting
 *
 * Every accepted call mints a NEW long-lived secret, retiring the previous
 * one, and leaves the enrolment secret valid. So a machine that crashed
 * between this answer and writing its file simply runs `connector set`
 * again. The enrolment secret is retired by the first handshake made with a
 * long-lived secret (`HostSocketController`), or by its expiry.
 *
 * A root `$route`, like `HostPullController`: `/api/*` is the actions'
 * namespace. A missing, unknown, used-up or expired secret is the same
 * 401, and hands over nothing.
 */
export class HostEnrolController {
  /**
   * Bay wire v1: keeps the word Lore used before #E147, because every
   * running Bay posts to it (`EnrolPath` in `enrol.go`) and a new spelling
   * would need a binary swap on every host.
   */
  public static readonly PATH = "/estates/enrol";

  protected readonly log = $logger();
  protected readonly hosts = $repository(hosts);
  protected readonly tokens = $inject(HostTokenService);
  protected readonly dateTime = $inject(DateTimeProvider);

  enrol = $route({
    method: "POST",
    path: HostEnrolController.PATH,
    schema: {
      headers: z.object({ authorization: z.string().optional() }),
      response: hostEnrolExchangeSchema,
    },
    handler: async ({ headers }) => {
      const host = await this.tokens.verifyEnrolment(
        this.tokens.bearer(headers.authorization),
        this.dateTime.nowMillis(),
      );
      if (!host) {
        throw new UnauthorizedError("Unknown or expired enrolment secret");
      }
      const minted = await this.tokens.mint();
      await this.hosts.updateById(host.id, {
        secretHash: minted.hash,
        secretPrefix: minted.prefix,
      });
      this.log.info("A machine exchanged its enrolment secret", {
        hostId: host.id,
      });
      return { secret: minted.secret, slug: host.slug };
    },
  });
}
