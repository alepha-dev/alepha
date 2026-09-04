import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

import {
  type EstateCommandResource,
  estateCommandResourceSchema,
} from "../schemas/estateCommandResourceSchema.ts";
import { EstateCommandService } from "../services/EstateCommandService.ts";
import { EstateService } from "../services/EstateService.ts";

export type { EstateCommandResource };

/**
 * The owner's view of an estate's queue, and the one command an owner can
 * enqueue by hand in this epic: `restart`.
 *
 * `deploy` is deliberately absent from the body. It needs an artifact from a
 * project and an environment to name, and that is epic #1's deploy endpoint
 * (#1201), which resolves the estate server-side from the environment and
 * never takes one from the wire. Here the estate is the page the owner is on,
 * checked by ownership, which is a different thing from a client naming a
 * deploy destination.
 */
export class EstateCommandController {
  protected readonly estates = $inject(EstateService);
  protected readonly commands = $inject(EstateCommandService);

  listEstateCommands = $action({
    use: [$secure({ permissions: ["estate:read"] })],
    method: "GET",
    path: "/estates/:estateId/commands",
    schema: {
      params: z.object({ estateId: z.uuid() }),
      response: z.object({ items: z.array(estateCommandResourceSchema) }),
    },
    handler: async ({ params, user }) => {
      const estate = await this.estates.loadOwned(params.estateId, user);
      return { items: await this.commands.listFor(estate.id) };
    },
  });

  /**
   * Restart one app on the machine. Pushed the instant it is queued when the
   * machine is connected, delivered on its next connect otherwise.
   */
  restartEstateApp = $action({
    use: [$secure({ permissions: ["estate:update"] })],
    method: "POST",
    path: "/estates/:estateId/commands",
    schema: {
      params: z.object({ estateId: z.uuid() }),
      body: z.object({
        kind: z.literal("restart"),
        app: z.string().min(1).max(100),
        environment: z.string().min(1).max(100),
      }),
      response: estateCommandResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const estate = await this.estates.loadOwned(params.estateId, user);
      return this.commands.enqueue(
        estate,
        {
          kind: body.kind,
          payload: { app: body.app, environment: body.environment },
        },
        user.id,
      );
    },
  });
}
