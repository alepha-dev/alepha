import type { ProjectController } from "@lore/core/api";
import type {
  ProjectEstateController,
  StackController,
  StackDeployController,
} from "@lore/deploy/api";
import { $inject, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $client } from "alepha/server/links";

import { LoreClientService } from "./LoreClientService.ts";

/**
 * What the `lore stack` commands share (#Q2700): naming a stack (the project
 * slug unless `--name` says otherwise), an environment (created on its first
 * deploy), an estate by slug, and following a stack deploy to its end.
 */
export class LoreStackService {
  protected readonly client = $inject(LoreClientService);
  protected readonly dateTime = $inject(DateTimeProvider);

  protected readonly projects = $client<ProjectController>(this.client.scope());
  protected readonly stacks = $client<StackController>(this.client.scope());
  protected readonly deploys = $client<StackDeployController>(
    this.client.scope(),
  );
  protected readonly estates = $client<ProjectEstateController>(
    this.client.scope(),
  );

  /**
   * How often a follow asks, and how long it waits. A client giving up, never
   * a deploy cancelled: the deploy goes on, and the message says where.
   */
  public static readonly POLL_INTERVAL_MS = 2_000;
  public static readonly FOLLOW_TIMEOUT_MS = 30 * 60 * 1_000;

  /**
   * The stack's name: `--name`, else the project slug.
   */
  public async stackName(
    project: string,
    projectId: number,
    flag?: string,
  ): Promise<string> {
    if (flag) {
      return flag.trim().toLowerCase();
    }
    if (!/^\d+$/.test(project)) {
      return project;
    }
    const found = await this.projects.getProjectById({
      params: { id: projectId },
    });
    return found.slug ?? project;
  }

  public async findStack(projectId: number, name: string) {
    const { items } = await this.stacks.listStacks({ params: { projectId } });
    return items.find((stack) => stack.name === name);
  }

  public async getStack(projectId: number, name: string) {
    const stack = await this.findStack(projectId, name);
    if (!stack) {
      throw new AlephaError(
        `This project has no stack named ${name}. Create it with \`lore stack create --file compose.yml --estate <estate>\`.`,
      );
    }
    return stack;
  }

  public environmentOf(
    stack: Awaited<ReturnType<LoreStackService["getStack"]>>,
    env: string,
  ) {
    const environment = stack.environments.find((e) => e.env === env);
    if (!environment) {
      throw new AlephaError(
        `Stack ${stack.name} has no environment ${env}. Deploy it once to create it: \`lore stack deploy --env ${env}\`.`,
      );
    }
    return environment;
  }

  /**
   * An estate lent to the project, by slug.
   */
  public async estateId(projectId: number, slug: string): Promise<string> {
    const { items } = await this.estates.listProjectEstates({
      params: { projectId },
    });
    const estate = items.find((e) => e.slug === slug);
    if (!estate) {
      throw new AlephaError(
        `No estate named ${slug} is lent to this project${items.length ? ` (lent: ${items.map((e) => e.slug).join(", ")})` : ""}. Add one with \`lore estate add ${slug}\`.`,
      );
    }
    return estate.id;
  }

  /**
   * Follows one stack deploy to its end, reporting each new step, and answers
   * the final row.
   */
  public async follow(
    target: { projectId: number; stackId: string; environmentId: string },
    deploymentId: string,
    report: (line: string) => void,
  ) {
    const startedAt = this.dateTime.nowMillis();
    let last = "";
    for (;;) {
      const { items } = await this.deploys.listStackDeployments({
        params: target,
      });
      const row = items.find((item) => item.id === deploymentId);
      if (!row) {
        throw new AlephaError(
          `The deploy ${deploymentId} is not in this environment's log.`,
        );
      }
      const now = row.step ? `${row.status} (${row.step})` : row.status;
      if (now !== last) {
        report(now);
        last = now;
      }
      if (row.status === "succeeded" || row.status === "failed") {
        return row;
      }
      if (
        this.dateTime.nowMillis() - startedAt >
        LoreStackService.FOLLOW_TIMEOUT_MS
      ) {
        throw new AlephaError(
          `Stopped following deploy ${deploymentId} after 30 minutes. It is still going on the machine: \`lore stack ps\` and the stack's Deploys tab say where it is.`,
        );
      }
      await this.dateTime.wait(LoreStackService.POLL_INTERVAL_MS);
    }
  }
}
