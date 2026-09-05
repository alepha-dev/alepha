import { $inject, z } from "alepha";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, ForbiddenError, NotFoundError } from "alepha/server";

import { artifacts } from "../entities/artifacts.ts";
import { estateProjects } from "../entities/estateProjects.ts";
import {
  type EstateCommandResource,
  estateCommandResourceSchema,
} from "../schemas/estateCommandResourceSchema.ts";
import { EstateCommandService } from "../services/EstateCommandService.ts";
import { EstateService } from "../services/EstateService.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

export type { EstateCommandResource };

/**
 * The owner's view of an estate's queue, and the two commands an owner can
 * enqueue by hand in this epic.
 *
 * `restart` names an instance on the machine and nothing else. `deploy`
 * names an artifact by id: the app comes from the artifact row, the digest
 * is snapshotted into the payload, and Bay pulls the bytes by command id
 * (#1844). Three gates on a deploy, each server-side: the caller owns the
 * estate, is a member of the artifact's project, and the estate is lent to
 * that project. The estate's own `deployAllowed` switch is the fourth,
 * enforced by `EstateCommandService.enqueue` and again by the connector.
 *
 * Epic #1's deploy endpoint (#1201) is the one that resolves an estate from
 * an environment row; this is the owner's hand-driven path, which is what
 * the end-to-end test (#1628) drives.
 */
export class EstateCommandController {
  protected readonly estates = $inject(EstateService);
  protected readonly commands = $inject(EstateCommandService);
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly artifacts = $repository(artifacts);
  protected readonly grants = $repository(estateProjects);

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
   * Queue a command for one of the caller's estates. Pushed the instant it
   * is queued when the machine is connected, delivered on its next connect
   * otherwise.
   */
  enqueueEstateCommand = $action({
    use: [$secure({ permissions: ["estate:update"] })],
    method: "POST",
    path: "/estates/:estateId/commands",
    schema: {
      params: z.object({ estateId: z.uuid() }),
      body: z.union([
        z.object({
          kind: z.literal("restart"),
          app: z.string().min(1).max(100),
          environment: z.string().min(1).max(100),
        }),
        z.object({
          kind: z.literal("deploy"),
          artifactId: z.uuid(),
          environment: z.string().min(1).max(100),
        }),
      ]),
      response: estateCommandResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const estate = await this.estates.loadOwned(params.estateId, user);

      if (body.kind === "restart") {
        return this.commands.enqueue(
          estate,
          {
            kind: "restart",
            payload: { app: body.app, environment: body.environment },
          },
          user.id,
        );
      }

      const artifact = await this.artifacts.findOne({
        where: { id: { eq: body.artifactId } },
      });
      if (!artifact) {
        throw new NotFoundError("Artifact not found");
      }
      await this.security.assertMember(artifact.projectId, user);
      const lent = await this.grants.findOne({
        where: {
          estateId: { eq: estate.id },
          projectId: { eq: artifact.projectId },
        },
      });
      if (!lent) {
        throw new ForbiddenError(
          `Estate "${estate.slug}" is not lent to the project this artifact belongs to`,
        );
      }

      return this.commands.enqueue(
        estate,
        {
          kind: "deploy",
          payload: {
            app: artifact.app,
            environment: body.environment,
            artifact: {
              id: artifact.id,
              sha256: artifact.sha256,
              size: artifact.size,
            },
          },
        },
        user.id,
      );
    },
  });
}
