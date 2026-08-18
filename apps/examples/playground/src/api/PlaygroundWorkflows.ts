import { z } from "alepha";
import { $workflow } from "alepha/api/workflows";
import { $logger } from "alepha/logger";

/**
 * Demo workflows covering the $workflow feature set: sequential steps
 * with threaded results, saga compensation, per-step retry and a durable
 * delayed step. The admin /workflows page drives and inspects them.
 */
export class PlaygroundWorkflows {
  protected readonly log = $logger();

  /**
   * The happy-path saga: three steps, results threaded forward, each
   * step compensable. Fail it on demand via `payload.failAt`.
   */
  public readonly orderFulfilment = $workflow({
    schema: z.object({
      orderId: z.text(),
      failAt: z.enum(["charge", "ship"]).optional(),
    }),
    tags: ["demo", "commerce"],
    steps: [
      {
        name: "reserveStock",
        handler: async ({ payload }) => {
          return { reservationId: `res-${payload.orderId}` };
        },
        compensate: async ({ result }) => {
          void result;
        },
      },
      {
        name: "charge",
        retry: { retries: 2, backoff: [2, "second"] },
        handler: async ({ payload, results }) => {
          if (payload.failAt === "charge") {
            throw new Error("payment declined (demo)");
          }
          return { chargeId: `ch-${payload.orderId}`, after: results };
        },
        compensate: async () => {
          // Refund would go here.
        },
      },
      {
        name: "ship",
        handler: async ({ payload }) => {
          if (payload.failAt === "ship") {
            throw new Error("carrier unavailable (demo)");
          }
          return { trackingId: `trk-${payload.orderId}` };
        },
      },
    ],
  });

  /**
   * Durable delayed step: the follow-up waits two minutes after the
   * first step, surviving restarts — the abandoned-cart shape.
   */
  public readonly reminderSequence = $workflow({
    schema: z.object({ email: z.text() }),
    tags: ["demo", "sequence"],
    steps: [
      {
        name: "recordIntent",
        handler: async ({ payload }) => ({ email: payload.email }),
      },
      {
        name: "sendReminder",
        delay: [2, "minute"],
        handler: async ({ payload }) => {
          this.log.info("reminder sent (demo)", { to: payload.email });
          return { sent: true };
        },
      },
    ],
  });
}
