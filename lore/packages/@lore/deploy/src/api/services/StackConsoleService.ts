import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import { BadRequestError, NotFoundError } from "alepha/server";

import type { EstateCommand } from "../entities/estateCommands.ts";
import { estateProjects } from "../entities/estateProjects.ts";
import { estates } from "../entities/estates.ts";
import type { StackModel } from "../schemas/stackModelSchema.ts";
import type { StackServicesResource } from "../schemas/stackServicesResourceSchema.ts";
import { EstateCommandService } from "./EstateCommandService.ts";
import { EstateInventoryService } from "./EstateInventoryService.ts";
import { StackService } from "./StackService.ts";

/**
 * What the stack console reads and asks beyond deploys (#Q2696): each
 * service with what the machine last reported about it, and the per-service
 * verbs (restart, stop, start), which Bay keys on the member
 * `<stack>.<service>/<env>`.
 */
export class StackConsoleService {
  protected readonly estates = $repository(estates);
  protected readonly grants = $repository(estateProjects);
  protected readonly stacks = $inject(StackService);
  protected readonly inventories = $inject(EstateInventoryService);
  protected readonly queue = $inject(EstateCommandService);

  public static readonly SERVICE_VERBS = ["restart", "stop", "start"] as const;

  async servicesOf(
    projectId: number,
    stackId: string,
    environmentId: string,
  ): Promise<StackServicesResource> {
    const stack = await this.stacks.get(projectId, stackId);
    const environment = await this.stacks.getEnvironment(stack, environmentId);
    const revision = environment.revision
      ? await this.stacks.getRevision(stack, environment.revision)
      : undefined;
    const model = revision
      ? (JSON.parse(revision.model) as StackModel)
      : undefined;
    const estateId = this.stacks.estateOf(stack, environment);
    const inventory = estateId
      ? await this.inventories.findFor(estateId)
      : undefined;
    const members = new Map(
      (inventory?.apps ?? [])
        .filter(
          (app) =>
            app.stack === stack.name &&
            app.env === environment.env &&
            app.service,
        )
        .map((app) => [app.service as string, app]),
    );
    const reported = inventory?.stacks?.find(
      (s) => s.stack === stack.name && s.env === environment.env,
    );
    return {
      revision: environment.revision,
      reportedAt: inventory?.reportedAt,
      stopped: reported?.stopped,
      services: (model?.services ?? []).map((service) => {
        const member = members.get(service.name);
        return {
          name: service.name,
          kind: service.kind,
          app: service.app,
          image: service.image,
          routes: service.routes,
          digest: revision?.digests?.[service.name],
          state: member?.state,
          running: member?.running,
          memoryBytes: member?.memoryBytes,
          restarts: member?.restarts,
          startedAt: member?.startedAt,
          domains: member?.domains,
        };
      }),
      volumes: (model?.volumes ?? []).map((name) => ({
        name,
        ...(reported
          ? { backedUp: !(reported.notBackedUp ?? []).includes(name) }
          : {}),
      })),
    };
  }

  /**
   * Restarts, stops or starts one service of a stack environment. `stop` is
   * durable on Bay, as for an app: the way back is `start` or a deploy.
   */
  async serviceAction(input: {
    projectId: number;
    stackId: string;
    environmentId: string;
    service: string;
    verb: (typeof StackConsoleService.SERVICE_VERBS)[number];
    requestedBy?: string;
  }): Promise<EstateCommand> {
    const stack = await this.stacks.get(input.projectId, input.stackId);
    const environment = await this.stacks.getEnvironment(
      stack,
      input.environmentId,
    );
    if (!environment.revision) {
      throw new BadRequestError(
        `${stack.name}/${environment.env} has never been deployed`,
      );
    }
    const model = JSON.parse(
      (await this.stacks.getRevision(stack, environment.revision)).model,
    ) as StackModel;
    if (!model.services.some((s) => s.name === input.service)) {
      throw new NotFoundError(
        `${stack.name}/${environment.env} has no service ${input.service}`,
      );
    }
    const estateId = this.stacks.estateOf(stack, environment);
    const estate = estateId ? await this.estates.findById(estateId) : undefined;
    const grant = estate
      ? await this.grants.findOne({
          where: {
            estateId: { eq: estate.id },
            projectId: { eq: stack.projectId },
          },
        })
      : undefined;
    if (!estate || !grant) {
      throw new BadRequestError(
        `${stack.name}/${environment.env} runs on no estate lent to this project`,
      );
    }
    return await this.queue.enqueue(
      estate,
      {
        kind: input.verb,
        payload: {
          app: `${stack.name}.${input.service}`,
          environment: environment.env,
        },
      },
      input.requestedBy,
    );
  }
}
