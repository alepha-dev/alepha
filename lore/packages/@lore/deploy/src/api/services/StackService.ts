import { APP_NAME_PATTERN, projects } from "@lore/core/schemas";
import { $inject, type FileLike } from "alepha";
import { FileService } from "alepha/api/files";
import { $repository, DbConflictError } from "alepha/orm";
import { BadRequestError, ConflictError, NotFoundError } from "alepha/server";

import { type AppInstance, appInstances } from "../entities/appInstances.ts";
import { estateProjects } from "../entities/estateProjects.ts";
import { estates } from "../entities/estates.ts";
import {
  type StackEnvironmentRoute,
  stackEnvironmentRoutes,
} from "../entities/stackEnvironmentRoutes.ts";
import {
  type StackEnvironment,
  stackEnvironments,
} from "../entities/stackEnvironments.ts";
import {
  type StackRevision,
  stackRevisions,
} from "../entities/stackRevisions.ts";
import { type Stack, stacks } from "../entities/stacks.ts";
import { ArtifactService } from "./ArtifactService.ts";
import { StackBundleReader } from "./StackBundleReader.ts";
import { StackComposeParser } from "./StackComposeParser.ts";
import { StackTargets } from "./StackTargets.ts";

/**
 * What a revision upload hands the service: the bundle as uploaded, its
 * digest, and what was read from it.
 */
export interface StackRevisionInput {
  stack: Stack;
  file: FileLike;
  sha256: string;
  size: number;
  model: string;
  compose: string;
  createdBy?: string;
}

/**
 * The one write path for stacks, their environments, routes and revisions,
 * and for the link between an app instance and a stack environment.
 *
 * Authorization is the controller's (`deploy:manage` behind the `apps.deploy`
 * capability). What is checked here is the integrity of the references, which
 * no caller may skip: an estate must be LENT to the project, an app instance
 * must be of the stack's project and of the environment's own env name, and
 * belongs to at most one environment, which the column itself guarantees.
 */
export class StackService {
  protected readonly stacks = $repository(stacks);
  protected readonly environments = $repository(stackEnvironments);
  protected readonly routes = $repository(stackEnvironmentRoutes);
  protected readonly revisions = $repository(stackRevisions);
  protected readonly instances = $repository(appInstances);
  protected readonly grants = $repository(estateProjects);
  protected readonly projects = $repository(projects);
  protected readonly estates = $repository(estates);
  protected readonly files = $inject(FileService);
  protected readonly bundles = $inject(StackBundleReader);
  protected readonly parser = $inject(StackComposeParser);
  protected readonly targets = $inject(StackTargets);

  /**
   * Normalises a stack or environment name, the way `AppService.normalize`
   * does an app name: it is a URL segment and a Bay name, so the same rule.
   */
  normalize(raw: string, label: "stack" | "environment"): string {
    const value = raw.trim().toLowerCase();
    if (!APP_NAME_PATTERN.test(value) || value.length > 64) {
      throw new BadRequestError(
        `A ${label} name may only contain lowercase letters, digits and hyphens, start and end with a letter or digit, and be at most 64 characters`,
      );
    }
    return value;
  }

  async list(projectId: number): Promise<Stack[]> {
    return await this.stacks.findMany({
      where: { projectId: { eq: projectId } },
      orderBy: { column: "name", direction: "asc" },
    });
  }

  /**
   * One stack of this project, or 404. The project is part of the lookup, so
   * a stack id from another project reads as missing rather than as somebody
   * else's.
   */
  async get(projectId: number, stackId: string): Promise<Stack> {
    const stack = await this.stacks.findOne({
      where: { id: { eq: stackId }, projectId: { eq: projectId } },
    });
    if (!stack) {
      throw new NotFoundError("This project has no such stack");
    }
    return stack;
  }

  async create(input: {
    projectId: number;
    name?: string;
    estateId?: string;
    createdBy?: string;
  }): Promise<Stack> {
    let raw = input.name;
    if (!raw) {
      const project = await this.projects.findById(input.projectId);
      raw = project?.slug ?? String(input.projectId);
    }
    const name = this.normalize(raw, "stack");
    if (input.estateId) {
      await this.assertLent(input.projectId, input.estateId);
    }
    try {
      return await this.stacks.create({
        projectId: input.projectId,
        name,
        estateId: input.estateId,
        createdBy: input.createdBy,
      });
    } catch (error) {
      if (error instanceof DbConflictError) {
        throw new ConflictError(
          `This project already has a stack named ${name}`,
        );
      }
      throw error;
    }
  }

  /**
   * Sets or clears the stack's default estate.
   */
  async setEstate(stack: Stack, estateId: string | null): Promise<Stack> {
    if (estateId !== null) {
      await this.assertLent(stack.projectId, estateId);
    }
    await this.stacks.updateById(stack.id, { estateId });
    return { ...stack, estateId: estateId ?? undefined };
  }

  /**
   * Deletes a stack, its environments, routes and revisions, and the bundle
   * bytes, which no cascade reaches. Its member apps survive as ordinary
   * copies: their link is `set null`.
   */
  async delete(stack: Stack): Promise<void> {
    const revisions = await this.revisions.findMany({
      where: { stackId: { eq: stack.id } },
    });
    await this.stacks.deleteById(stack.id);
    for (const revision of revisions) {
      await this.files.deleteFile(revision.fileId).catch(() => undefined);
    }
  }

  // -------------------------------------------------------------------------
  // environments
  // -------------------------------------------------------------------------

  async environmentsOf(stackIds: string[]): Promise<StackEnvironment[]> {
    if (stackIds.length === 0) {
      return [];
    }
    return await this.environments.findMany({
      where: { stackId: { inArray: stackIds } },
      orderBy: { column: "env", direction: "asc" },
    });
  }

  async getEnvironment(
    stack: Stack,
    environmentId: string,
  ): Promise<StackEnvironment> {
    const environment = await this.environments.findOne({
      where: { id: { eq: environmentId }, stackId: { eq: stack.id } },
    });
    if (!environment) {
      throw new NotFoundError(`Stack ${stack.name} has no such environment`);
    }
    return environment;
  }

  async createEnvironment(
    stack: Stack,
    input: { env: string; estateId?: string; baseDomain?: string },
  ): Promise<StackEnvironment> {
    const env = this.normalize(input.env, "environment");
    if (input.estateId) {
      await this.assertLent(stack.projectId, input.estateId);
    }
    try {
      return await this.environments.create({
        stackId: stack.id,
        env,
        estateId: input.estateId,
        baseDomain: this.domain(input.baseDomain),
      });
    } catch (error) {
      if (error instanceof DbConflictError) {
        throw new ConflictError(
          `Stack ${stack.name} already has an environment named ${env}`,
        );
      }
      throw error;
    }
  }

  /**
   * Updates an environment's estate override (null clears it, back to the
   * stack's default) and base domain (null clears it).
   */
  async updateEnvironment(
    stack: Stack,
    environment: StackEnvironment,
    input: { estateId?: string | null; baseDomain?: string | null },
  ): Promise<StackEnvironment> {
    const patch: { estateId?: string | null; baseDomain?: string | null } = {};
    if (input.estateId !== undefined) {
      if (input.estateId !== null) {
        await this.assertLent(stack.projectId, input.estateId);
      }
      patch.estateId = input.estateId;
    }
    if (input.baseDomain !== undefined) {
      patch.baseDomain =
        input.baseDomain === null ? null : this.domain(input.baseDomain);
    }
    await this.environments.updateById(environment.id, patch);
    return await this.getEnvironment(stack, environment.id);
  }

  async deleteEnvironment(environment: StackEnvironment): Promise<void> {
    await this.environments.deleteById(environment.id);
  }

  /**
   * The estate an environment deploys to: its own, else the stack's default.
   * Undefined when neither is set.
   */
  estateOf(stack: Stack, environment: StackEnvironment): string | undefined {
    return environment.estateId ?? stack.estateId;
  }

  // -------------------------------------------------------------------------
  // routes
  // -------------------------------------------------------------------------

  async routesOf(environmentIds: string[]): Promise<StackEnvironmentRoute[]> {
    if (environmentIds.length === 0) {
      return [];
    }
    return await this.routes.findMany({
      where: { environmentId: { inArray: environmentIds } },
      orderBy: { column: "domain", direction: "asc" },
    });
  }

  async addRoute(
    environment: StackEnvironment,
    input: { service: string; domain: string },
  ): Promise<StackEnvironmentRoute> {
    const service = input.service.trim();
    if (!service || service.length > 100) {
      throw new BadRequestError("A route names the service it serves");
    }
    const domain = this.domain(input.domain);
    if (!domain) {
      throw new BadRequestError("A route needs a full domain");
    }
    try {
      return await this.routes.create({
        environmentId: environment.id,
        service,
        domain,
      });
    } catch (error) {
      if (error instanceof DbConflictError) {
        throw new ConflictError(
          `${domain} is already routed in this environment`,
        );
      }
      throw error;
    }
  }

  async removeRoute(
    environment: StackEnvironment,
    domain: string,
  ): Promise<void> {
    const route = await this.routes.findOne({
      where: {
        environmentId: { eq: environment.id },
        domain: { eq: domain.trim().toLowerCase() },
      },
    });
    if (!route) {
      throw new NotFoundError(`${domain} is not routed in this environment`);
    }
    await this.routes.deleteById(route.id);
  }

  // -------------------------------------------------------------------------
  // revisions
  // -------------------------------------------------------------------------

  async revisionsOf(stack: Stack): Promise<StackRevision[]> {
    return await this.revisions.findMany({
      where: { stackId: { eq: stack.id } },
      orderBy: { column: "number", direction: "desc" },
    });
  }

  async getRevision(stack: Stack, number: number): Promise<StackRevision> {
    const revision = await this.revisions.findOne({
      where: { stackId: { eq: stack.id }, number: { eq: number } },
    });
    if (!revision) {
      throw new NotFoundError(`Stack ${stack.name} has no revision ${number}`);
    }
    return revision;
  }

  /**
   * Reads, parses and checks an uploaded bundle, then stores it as the next
   * revision. Refused, with every reason at once, when the file is unreadable
   * or when a target the stack deploys to cannot run it.
   */
  async uploadRevision(
    stack: Stack,
    file: FileLike,
    createdBy?: string,
  ): Promise<StackRevision> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const bundle = await this.bundles.read(bytes);
    const model = this.parser.parse(bundle.compose, bundle.files);
    this.targets.assert(model, await this.targetsOf(stack));
    return await this.addRevision({
      stack,
      file: new File([bundle.bytes as BlobPart], "bundle.tar.gz", {
        type: "application/gzip",
      }),
      sha256: bundle.sha256,
      size: bundle.bytes.length,
      model: JSON.stringify(model),
      compose: bundle.compose,
      createdBy,
    });
  }

  /**
   * The targets a stack's revisions must run on: the type of every estate it
   * or one of its environments deploys to, and Bay when none is chosen yet,
   * since Bay is the one target that runs stacks today.
   */
  async targetsOf(stack: Stack): Promise<string[]> {
    const envs = await this.environmentsOf([stack.id]);
    const ids = [stack.estateId, ...envs.map((e) => e.estateId)].filter(
      (id): id is string => !!id,
    );
    if (ids.length === 0) {
      return ["bay"];
    }
    const rows = await this.estates.findMany({
      where: { id: { inArray: [...new Set(ids)] } },
    });
    return rows.length === 0 ? ["bay"] : [...new Set(rows.map((r) => r.type))];
  }

  /**
   * Stores a revision: the bundle's bytes in the artifacts bucket, then the
   * row, numbered one past the newest. Bytes first, so a failure in between
   * leaves an orphaned blob rather than a row pointing at nothing.
   *
   * ⚠️ Two uploads at once race on the number; the unique index makes the
   * loser fail rather than share it, and its bytes are removed.
   */
  async addRevision(input: StackRevisionInput): Promise<StackRevision> {
    const stored = await this.files.uploadFile(input.file, {
      bucket: ArtifactService.BUCKET,
      tags: [`project:${input.stack.projectId}`, `stack:${input.stack.name}`],
    });
    const newest = await this.revisions.findMany({
      where: { stackId: { eq: input.stack.id } },
      orderBy: { column: "number", direction: "desc" },
      limit: 1,
    });
    try {
      return await this.revisions.create({
        stackId: input.stack.id,
        number: (newest[0]?.number ?? 0) + 1,
        fileId: stored.id,
        sha256: input.sha256,
        size: input.size,
        model: input.model,
        compose: input.compose,
        createdBy: input.createdBy,
      });
    } catch (error) {
      await this.files.deleteFile(stored.id).catch(() => undefined);
      if (error instanceof DbConflictError) {
        throw new ConflictError(
          "Another revision was uploaded at the same time: retry",
        );
      }
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // members
  // -------------------------------------------------------------------------

  async membersOf(environmentIds: string[]): Promise<AppInstance[]> {
    if (environmentIds.length === 0) {
      return [];
    }
    return await this.instances.findMany({
      where: { stackEnvironmentId: { inArray: environmentIds } },
    });
  }

  /**
   * Makes an app instance a member of a stack environment.
   *
   * Refused unless the instance is of the stack's own project and carries the
   * environment's own env name (`mcs-api/staging` joins `mcs/staging`, never
   * `mcs/production`), and unless it is a member of no other environment:
   * moving a copy between stacks is a detach then an attach, said out loud.
   */
  async attachInstance(
    stack: Stack,
    environment: StackEnvironment,
    instanceId: string,
  ): Promise<AppInstance> {
    const instance = await this.instances.findOne({
      where: { id: { eq: instanceId }, projectId: { eq: stack.projectId } },
    });
    if (!instance) {
      throw new NotFoundError("This project has no such app instance");
    }
    if (instance.env !== environment.env) {
      throw new BadRequestError(
        `${instance.app}/${instance.env} cannot join ${stack.name}/${environment.env}: an app joins the stack environment of its own env name`,
      );
    }
    if (
      instance.stackEnvironmentId &&
      instance.stackEnvironmentId !== environment.id
    ) {
      throw new ConflictError(
        `${instance.app}/${instance.env} is already a member of another stack environment: detach it first`,
      );
    }
    await this.instances.updateById(instance.id, {
      stackEnvironmentId: environment.id,
    });
    return { ...instance, stackEnvironmentId: environment.id };
  }

  async detachInstance(
    environment: StackEnvironment,
    instanceId: string,
  ): Promise<void> {
    const instance = await this.instances.findOne({
      where: {
        id: { eq: instanceId },
        stackEnvironmentId: { eq: environment.id },
      },
    });
    if (!instance) {
      throw new NotFoundError(
        "That app instance is not a member of this environment",
      );
    }
    await this.instances.updateById(instance.id, { stackEnvironmentId: null });
  }

  // -------------------------------------------------------------------------
  // checks
  // -------------------------------------------------------------------------

  /**
   * Refuses an estate the project was never lent, with the message
   * `AppService.setEstate` gives, so the two cannot be told apart.
   */
  protected async assertLent(
    projectId: number,
    estateId: string,
  ): Promise<void> {
    const grant = await this.grants.findOne({
      where: { estateId: { eq: estateId }, projectId: { eq: projectId } },
    });
    if (!grant) {
      throw new NotFoundError("This project has no such estate");
    }
  }

  /**
   * Normalises a full domain: trimmed, lowercased, no scheme, no path.
   * Undefined for an empty value.
   */
  protected domain(raw: string | undefined): string | undefined {
    const value = raw?.trim().toLowerCase();
    if (!value) {
      return undefined;
    }
    if (
      value.length > 253 ||
      !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(
        value,
      )
    ) {
      throw new BadRequestError(`${raw} is not a domain`);
    }
    return value;
  }
}
